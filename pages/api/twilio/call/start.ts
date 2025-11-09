import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";
import { isCallAllowedForLead } from "@/utils/checkCallTime";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const VOICE_ANSWER_URL = `${BASE}/api/twilio/voice-answer`;

// We include userEmail in the status callback URL so we can bill the right user.
function voiceStatusUrl(email: string) {
  const encoded = encodeURIComponent(email.toLowerCase());
  return `${BASE}/api/twilio/voice-status?userEmail=${encoded}`;
}

function normalizeE164(p?: string) {
  const raw = String(p || "");
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return raw.startsWith("+") ? raw : `+${d}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  const email = String(session?.user?.email || "").toLowerCase();
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const body = (req.body || {}) as {
    leadId?: string;
    to?: string;                // backward-compat
  };

  try {
    await dbConnect();
  } catch {
    // continue; getClientForUser will also connect
  }

  // --- Resolve the lead if provided, and enforce quiet hours per lead ---
  let toNumber = "";
  let leadDoc: any = null;

  if (body.leadId) {
    // Scope the lookup to the signed-in user
    leadDoc = await Lead.findOne({ _id: body.leadId, userEmail: email }).lean();
    if (!leadDoc) return res.status(404).json({ error: "Lead not found" });

    // Enforce 8am–9pm in lead's local zone
    const { allowed, zone } = isCallAllowedForLead(leadDoc);
    if (!allowed) {
      return res.status(409).json({
        error: `Quiet hours — local time for this lead is outside 8am–9pm`,
        zone: zone || null,
      });
    }

    // Extract a phone for the lead (handle various schemas)
    const candidates = [
      leadDoc.phone,
      leadDoc.Phone,
      leadDoc.mobile,
      leadDoc.Mobile,
      leadDoc.primaryPhone,
      leadDoc["Primary Phone"],
    ].filter(Boolean);
    toNumber = normalizeE164(candidates[0]);
  } else {
    // Backward-compat path: accept raw "to" and allow if timezone unknown.
    toNumber = normalizeE164(body.to);
  }

  if (!toNumber) return res.status(400).json({ error: "Missing or invalid destination number" });

  try {
    const { client } = await getClientForUser(email);
    const from = await pickFromNumberForUser(email);
    if (!from) {
      return res.status(400).json({ error: "No outbound caller ID configured. Buy a number first." });
    }

    const call = await client.calls.create({
      to: toNumber,
      from,
      url: VOICE_ANSWER_URL,
      statusCallback: voiceStatusUrl(email),
      statusCallbackEvent: ["completed"],
      record: false,
    });

    // Backward-compat response (do not break existing callers)
    return res.status(200).json({
      ok: true,
      success: true,                 // extra convenience flag
      sid: call.sid,
      callSid: call.sid,             // alias
      from,
      to: toNumber,
      // conferenceName is managed by your /api/twilio/voice/call route;
      // this endpoint historically didn't return it. Keeping shape stable.
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Call failed" });
  }
}
