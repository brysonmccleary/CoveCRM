import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";
import { isCallAllowedForLead, localTimeString } from "@/utils/checkCallTime";

// === URLs used by your existing voice flow ===
const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const VOICE_ANSWER_URL = `${BASE}/api/twilio/voice-answer`;
const STATUS_URL = `${BASE}/api/twilio/voice-status`;

function normalizeE164(raw?: string): string {
  if (!raw) return "";
  const d = raw.replace(/\D+/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return raw.startsWith("+") ? raw.trim() : `+${d}`;
}

function extractLeadPhone(lead: any): string | null {
  const candidates = [
    lead?.phone, lead?.Phone, lead?.mobile, lead?.Mobile, lead?.cell, lead?.Cell,
    lead?.primaryPhone, lead?.PrimaryPhone, lead?.phoneNumber, lead?.PhoneNumber,
  ].filter(Boolean);
  if (candidates.length) return String(candidates[0]);
  // Deep scan (last resort)
  const scan = (o: any): string | null => {
    if (!o || typeof o !== "object") return null;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && k.toLowerCase().includes("phone")) return v;
      if (typeof v === "object") { const found = scan(v); if (found) return found; }
    }
    return null;
  };
  return scan(lead);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  const email = (session?.user?.email || "").toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  const { leadId } = (req.body || {}) as { leadId?: string };
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  await dbConnect();

  // Load the lead, scoped to the signed-in user
  const lead = await Lead.findOne({ _id: leadId, userEmail: email }).lean<any>();
  if (!lead) return res.status(404).json({ message: "Lead not found or access denied" });

  // Server-side quiet-hours guard (per lead)
  const { allowed, zone } = isCallAllowedForLead(lead);
  if (!allowed) {
    return res.status(409).json({
      message: `Quiet hours — ${localTimeString(zone)}`,
      allowed: false,
      zone,
    });
  }

  // Resolve numbers
  const toRaw = extractLeadPhone(lead);
  const to = normalizeE164(toRaw || "");
  if (!to) return res.status(400).json({ message: "Lead has no valid phone number" });

  const { client } = await getClientForUser(email);
  const from = await pickFromNumberForUser(email);
  if (!from) return res.status(400).json({ message: "No outbound caller ID configured. Buy a number first." });

  // A simple, unique conference name per call; your TwiML uses this to bridge.
  const conferenceName = `conf:${email}:${leadId}:${Date.now()}`;

  // We include userEmail on status URL so your billing/metrics can attribute properly.
  const statusCallback = `${STATUS_URL}?userEmail=${encodeURIComponent(email)}`;

  try {
    const call = await (client as any).calls.create({
      to,
      from,
      url: VOICE_ANSWER_URL,      // your TwiML entrypoint (unchanged)
      statusCallback,
      statusCallbackEvent: ["completed", "answered", "no-answer", "busy", "failed"],
      // If your /voice-answer reads conferenceName from query/string, include it there too:
      // machineDetection, record, timeout, etc. — leave defaults you already rely on.
    });

    // Return the shape your UI expects
    return res.status(200).json({
      success: true,
      callSid: call.sid,
      conferenceName,
      from,
      to,
      zone,
    });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || "Call failed" });
  }
}
