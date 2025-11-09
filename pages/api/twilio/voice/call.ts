import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Call from "@/models/Call";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";
import { isCallAllowedForLead } from "@/utils/checkCallTime";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

// TwiML join endpoint (already working)
const VOICE_CONTINUE_PATH = "/api/twiml/voice/continue";
const voiceContinueUrl = (conference: string) =>
  `${BASE}${VOICE_CONTINUE_PATH}?conference=${encodeURIComponent(conference)}`;

const voiceStatusUrl = (email: string) =>
  `${BASE}/api/twilio/voice-status?userEmail=${encodeURIComponent(email.toLowerCase())}`;

function normalizeE164(p?: string) {
  const raw = String(p || "");
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return raw.startsWith("+") ? raw : `+${d}`;
}

function makeConferenceName(email: string) {
  const slug = email.replace(/[^a-z0-9]+/gi, "_").toLowerCase().slice(0, 24);
  const rand = Math.random().toString(36).slice(2, 8);
  return `cove_${slug}_${Date.now().toString(36)}_${rand}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const email = String(session?.user?.email ?? "").toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  const { leadId } = (req.body || {}) as { leadId?: string };
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  try {
    await dbConnect();

    const leadDoc: any = await Lead.findOne({ _id: leadId, userEmail: email }).lean();
    if (!leadDoc) return res.status(404).json({ message: "Lead not found or access denied" });

    const { allowed, zone } = isCallAllowedForLead(leadDoc);
    if (!allowed) {
      return res.status(409).json({
        message: "Quiet hours — local time for this lead is outside 8am–9pm",
        zone: zone || null,
      });
    }

    const candidates = [
      leadDoc.phone,
      leadDoc.Phone,
      leadDoc.mobile,
      leadDoc.Mobile,
      leadDoc.primaryPhone,
      leadDoc["Primary Phone"],
    ].filter(Boolean);
    const to = normalizeE164(candidates[0]);
    if (!to) return res.status(400).json({ message: "Lead has no valid phone number" });

    const { client } = await getClientForUser(email);
    const from = await pickFromNumberForUser(email);
    if (!from) return res.status(400).json({ message: "No outbound caller ID configured. Buy a number first." });

    const conferenceName = makeConferenceName(email);

    const call = await client.calls.create({
      to,
      from,
      url: voiceContinueUrl(conferenceName),
      statusCallback: voiceStatusUrl(email),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      record: false,
    });

    // ✅ Upsert a Call row immediately so the dashboard has something to aggregate
    const now = new Date();
    await Call.findOneAndUpdate(
      { callSid: call.sid },
      {
        $setOnInsert: {
          userEmail: email,
          leadId,
          callSid: call.sid,
          direction: "outbound",
          to,
          from,
          createdAt: now,
          startedAt: now, // treat placement as "started" for metrics
        },
        $set: { lastStatus: "initiated" },
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      callSid: call.sid,
      conferenceName,
      from,
      to,
    });
  } catch (e: any) {
    console.error("voice/call error:", e?.message || e);
    return res.status(500).json({ message: e?.message || "Call failed" });
  }
}
