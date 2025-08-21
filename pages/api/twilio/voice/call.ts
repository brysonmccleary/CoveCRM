// /pages/api/twilio/voice/call.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import twilioClient from "@/lib/twilioClient";
import Lead from "@/models/Lead";
import { getUserByEmail } from "@/models/User";

/** Base URL for TwiML + callbacks */
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  process.env.NEXTAUTH_URL ||
  ""
).replace(/\/$/, "");

/** Normalize to E.164 (US default if 10 digits) */
function e164(num: string) {
  if (!num) return "";
  const d = num.replace(/\D+/g, "");
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (num.startsWith("+")) return num;
  return `+${d}`;
}

/** Safely pluck user's agent phone from common fields */
function getAgentPhoneFromUser(user: any): string {
  const candidates = [
    user?.settings?.agentPhone,
    user?.agentPhone,
    user?.phone,
    user?.profile?.phone,
    user?.personalPhone,
  ].filter(Boolean);
  return e164(String(candidates[0] || ""));
}

/** Resolve user's default Twilio DID ("from" number) */
function getFromNumberForUser(user: any, override?: string): string {
  if (override) return e164(override);
  const from =
    user?.settings?.defaultFromNumber ||
    user?.defaultFromNumber ||
    (Array.isArray(user?.numbers) ? user.numbers[0]?.phoneNumber : undefined) ||
    process.env.TWILIO_CALLER_ID ||
    "";
  return e164(String(from || ""));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, agentPhone: agentPhoneRaw, fromNumber: fromNumberRaw } = req.body || {};
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  await dbConnect();

  const userEmail = String(session.user.email).toLowerCase();
  const user = await getUserByEmail(userEmail);
  if (!user) return res.status(404).json({ message: "User not found" });

  // Find the lead belonging to this user
  const lead: any = await Lead.findOne({ _id: leadId, userEmail }).lean();
  if (!lead) return res.status(404).json({ message: "Lead not found" });

  const leadPhone = e164(lead.Phone || lead.phone || lead["Phone Number"] || "");
  if (!leadPhone) return res.status(400).json({ message: "Lead has no phone number" });

  // Resolve numbers server-side (hands-off UX)
  const fromNumber = getFromNumberForUser(user, fromNumberRaw);
  if (!fromNumber) {
    return res.status(400).json({
      message: "No Twilio 'from' number on file. Buy or assign a number on the Numbers page.",
      fix: "Set users.settings.defaultFromNumber or assign a number to the user.",
    });
  }

  const agentPhone = e164(agentPhoneRaw || getAgentPhoneFromUser(user));
  if (!agentPhone) {
    return res.status(400).json({
      message: "Missing agent phone on profile.",
      fix: "Add your phone in Settings → Phone (users.settings.agentPhone).",
    });
  }

  // Build conference join URLs (these routes already exist in your app)
  const conferenceName = `conf_${Date.now()}_${String(user._id).slice(-6)}`;
  const agentUrl = `${BASE_URL}/api/voice/agent-join?conferenceName=${encodeURIComponent(conferenceName)}`;
  const leadUrl  = `${BASE_URL}/api/voice/lead-join?conferenceName=${encodeURIComponent(conferenceName)}`;

  try {
    // 1) Call the agent first (they’ll join muted / not starting the room)
    const agentCall = await twilioClient.calls.create({
      to: agentPhone,
      from: fromNumber,
      url: agentUrl,
      statusCallback: `${BASE_URL}/api/twilio/voice-status?who=agent&leadId=${encodeURIComponent(leadId)}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    // 2) Then call the lead (will start the conference on enter)
    const leadCall = await twilioClient.calls.create({
      to: leadPhone,
      from: fromNumber,
      url: leadUrl,
      // NOTE: older @types/twilio marks "record" boolean; omit here to avoid TS error and
      // record at the Conference level if desired via TwiML, or use status callbacks.
      statusCallback: `${BASE_URL}/api/twilio/voice-status?who=lead&leadId=${encodeURIComponent(leadId)}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    // (Optional) you could also write a quick DB log here if you prefer server-side logging.

    return res.status(200).json({
      success: true,
      conferenceName,
      agentCallSid: agentCall.sid,
      leadCallSid: leadCall.sid,
      fromNumber,
      agentPhone,
      leadPhone,
    });
  } catch (err: any) {
    console.error("❌ voice/call error:", err?.message || err);
    return res.status(500).json({
      message: "Failed to initiate call",
      error: err?.message || "unknown",
    });
  }
}
