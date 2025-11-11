import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Call from "@/models/Call";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";
import { isCallAllowedForLead } from "@/utils/checkCallTime";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const VOICE_ANSWER_URL = `${BASE}/api/twilio/voice-answer`;

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

  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const userEmail = String(session?.user?.email ?? "").toLowerCase();
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  const body = (req.body || {}) as { leadId?: string; to?: string };

  try { await dbConnect(); } catch {}

  // --- Resolve lead + enforce quiet hours (8am–9pm local) ---
  let toNumber = "";
  if (body.leadId) {
    const leadDoc: any = await Lead.findOne({ _id: body.leadId, userEmail }).lean();
    if (!leadDoc) return res.status(404).json({ error: "Lead not found" });

    const { allowed, zone } = isCallAllowedForLead(leadDoc);
    if (!allowed) {
      return res.status(409).json({
        error: "Quiet hours — local time for this lead is outside 8am–9pm",
        zone: zone || null,
      });
    }

    const candidates = [
      leadDoc.phone, leadDoc.Phone, leadDoc.mobile, leadDoc.Mobile,
      leadDoc.primaryPhone, leadDoc["Primary Phone"],
    ].filter(Boolean);
    toNumber = normalizeE164(candidates[0]);
  } else {
    toNumber = normalizeE164(body.to);
  }

  if (!toNumber) return res.status(400).json({ error: "Missing or invalid destination number" });

  try {
    const { client } = await getClientForUser(userEmail);
    const from = await pickFromNumberForUser(userEmail);
    if (!from) return res.status(400).json({ error: "No outbound caller ID configured. Buy a number first." });

    // 1) PLACE THE CALL WITH FULL STATUS CALLBACKS
    const call = await client.calls.create({
      to: toNumber,
      from,
      url: VOICE_ANSWER_URL,
      statusCallback: voiceStatusUrl(userEmail),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      record: false,
    });

    // 2) GUARANTEE A SEEDED ROW RIGHT NOW (counts as a dial)
    //    - so dashboard has a doc with userEmail + outbound + timestamps
    const now = new Date();
    await (Call as any).updateOne(
      { callSid: call.sid },
      {
        $setOnInsert: {
          callSid: call.sid,
          userEmail,
          direction: "outbound",
          createdAt: now,
          kind: "call",
        },
        $set: {
          ownerNumber: from,
          otherNumber: toNumber,
          from,
          to: toNumber,
          startedAt: now, // mark the attempt start so "Today" range always includes it
          updatedAt: now,
        },
      },
      { upsert: true }
    );

    return res.status(200).json({
      ok: true,
      success: true,
      sid: call.sid,
      callSid: call.sid,
      from,
      to: toNumber,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Call failed" });
  }
}
