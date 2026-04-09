// pages/api/twilio/voice/call.ts
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
import { checkCallingAllowed } from "@/lib/billing/checkCallingAllowed";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

// TwiML join endpoint (already working)
const VOICE_CONTINUE_PATH = "/api/twiml/voice/continue";
const voiceContinueUrl = (conference: string) =>
  `${BASE}${VOICE_CONTINUE_PATH}?conference=${encodeURIComponent(conference)}`;

const voiceStatusUrl = (email: string) =>
  `${BASE}/api/twilio/voice-status?userEmail=${encodeURIComponent(email.toLowerCase())}`;

function normalizeE164(p?: string) {
  const raw = String(p || "").trim();
  if (!raw) return "";

  // If already +E164-ish, validate it has enough digits
  if (raw.startsWith("+")) {
    const d = raw.replace(/\D/g, "");
    if (d.length >= 10 && d.length <= 15) return `+${d}`;
    return "";
  }

  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return "";
}

function pickLeadPhoneE164(leadDoc: any): string {
  const directCandidates: any[] = [
    leadDoc.phone,
    leadDoc.Phone,
    leadDoc.phoneNumber,
    leadDoc["Phone Number"],
    leadDoc.mobile,
    leadDoc.Mobile,
    leadDoc.cell,
    leadDoc.Cell,
    leadDoc.primaryPhone,
    leadDoc["Primary Phone"],
    leadDoc.otherPhone1,
    leadDoc["Other Phone 1"],
    leadDoc.otherPhone,
    leadDoc["Other Phone"],
  ].filter(Boolean);

  for (const c of directCandidates) {
    const e = normalizeE164(String(c));
    if (e) return e;
  }

  // If Lead stores imported columns inside a nested object, try common containers
  const containers = [
    leadDoc.data,
    leadDoc.fields,
    leadDoc.meta,
    leadDoc.raw,
    leadDoc.contact,
  ].filter(Boolean);

  for (const obj of containers) {
    if (!obj || typeof obj !== "object") continue;
    for (const k of Object.keys(obj)) {
      const key = String(k || "").toLowerCase();
      if (!key.includes("phone")) continue;
      const e = normalizeE164(String((obj as any)[k] ?? ""));
      if (e) return e;
    }
  }

  // Last resort: scan top-level keys that include "phone"
  for (const k of Object.keys(leadDoc || {})) {
    const key = String(k || "").toLowerCase();
    if (!key.includes("phone")) continue;
    const e = normalizeE164(String((leadDoc as any)[k] ?? ""));
    if (e) return e;
  }

  return "";
}


function makeConferenceName(email: string) {
  const slug = email.replace(/[^a-z0-9]+/gi, "_").toLowerCase().slice(0, 24);
  const rand = Math.random().toString(36).slice(2, 8);
  return `cove_${slug}_${Date.now().toString(36)}_${rand}`;
}

// ✅ Validate that a requested caller ID actually exists on THIS user's Twilio subaccount.
// If Twilio API errors for any reason, we safely fall back to the normal picker.
async function validateFromOnSubaccount(client: any, requestedFromE164: string): Promise<boolean> {
  try {
    const list = await client.incomingPhoneNumbers.list({
      phoneNumber: requestedFromE164,
      limit: 1,
    });
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const email = String(session?.user?.email ?? "").toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, to: toRaw, fromNumber, from, dialKey } = (req.body || {}) as {
    leadId?: string;
    to?: string;
    // allow either key so UI can send either
    fromNumber?: string;
    from?: string;
    dialKey?: string;
  };

  if (!leadId && !toRaw) return res.status(400).json({ message: "Missing leadId or to" });

  try {
    await dbConnect();

    const billingCheck = await checkCallingAllowed(email);
    if (!billingCheck.allowed) {
      return res.status(402).json({ message: billingCheck.reason });
    }

    const leadDoc: any = await Lead.findOne({ _id: leadId, userEmail: email }).lean();
    if (!leadDoc) return res.status(404).json({ message: "Lead not found or access denied" });

    const { allowed, zone } = isCallAllowedForLead(leadDoc);
    if (!allowed) {
      return res.status(409).json({
        message: "Quiet hours — local time for this lead is outside 8am–9pm",
        zone: zone || null,
      });
    }

    const to = toRaw ? normalizeE164(toRaw) : pickLeadPhoneE164(leadDoc);
    if (!to) return res.status(400).json({ message: "Lead has no valid phone number" });

    const { client } = await getClientForUser(email);
// ✅ If UI sent a from number, prefer it IF it exists on this user's subaccount.
    const requestedFrom = normalizeE164(fromNumber || from || "");
    let chosenFrom: string | null = null;

    if (requestedFrom) {
      const ok = await validateFromOnSubaccount(client, requestedFrom);
      if (ok) chosenFrom = requestedFrom;
    }

    if (!chosenFrom) {
      chosenFrom = await pickFromNumberForUser(email);
    }

    if (!chosenFrom) {
      return res.status(400).json({ message: "No outbound caller ID configured. Buy a number first." });
    }

    const conferenceName = makeConferenceName(email);

    const call = await client.calls.create({
      to,
      from: chosenFrom,
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
          from: chosenFrom,
          createdAt: now,
          startedAt: now, // treat placement as "started" for metrics,
          dialKey: (typeof dialKey === "string" && dialKey.trim()) ? dialKey.trim() : undefined
        },
        $set: { lastStatus: "initiated", conferenceName },
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      callSid: call.sid,
      conferenceName,
      from: chosenFrom,
      to,
      // helpful debugging (doesn't affect anything)
      requestedFrom: requestedFrom || null,
    });
  } catch (e: any) {
    console.error("voice/call error:", e?.message || e);
    return res.status(500).json({ message: e?.message || "Call failed" });
  }
}
