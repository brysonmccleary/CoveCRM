import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { sendSms } from "@/lib/twilio/sendSMS";

const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();

function normalizePhone(v: string): string {
  const digits = String(v || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return String(v || "").trim();
}

function formatAppointmentTime(appointmentTime: string, leadTimeZone?: string): string {
  try {
    const dt = new Date(appointmentTime);
    const tz = String(leadTimeZone || "America/Phoenix").trim() || "America/Phoenix";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(dt);
  } catch {
    return appointmentTime;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const hdr = String(req.headers["x-ai-dialer-key"] || "");
  const queryKey = String(req.query.key || "");
  const provided = hdr || queryKey;

  if (!AI_DIALER_CRON_KEY || !provided || provided !== AI_DIALER_CRON_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const {
    leadId,
    leadPhone,
    agentName,
    appointmentTime,
    leadTimeZone,
    agentTimeZone,
    userEmail,
  } = (req.body || {}) as {
    leadId?: string;
    leadPhone?: string;
    agentName?: string;
    appointmentTime?: string;
    leadTimeZone?: string;
    agentTimeZone?: string;
    userEmail?: string;
  };

  if (!leadPhone || !appointmentTime || !userEmail) {
    return res.status(400).json({ ok: false, error: "Missing required fields" });
  }

  await mongooseConnect();

  const email = String(userEmail || "").trim().toLowerCase();
  const user = await User.findOne({ email }).select("email firstName name a2p a2pStatus numbers defaultSmsNumberId").lean<any>();

  if (!user) {
    return res.status(404).json({ ok: false, error: "User not found" });
  }

  const topLevelA2p = String(user?.a2pStatus || "").toLowerCase();
  const brandStatus = String(user?.a2p?.brandStatus || "").toLowerCase();
  const campaignStatus = String(user?.a2p?.campaignStatus || "").toLowerCase();

  const approvedTopLevel = topLevelA2p === "approved" || topLevelA2p === "verified";
  const approvedNested =
    ["approved", "verified", "active"].includes(brandStatus) &&
    ["approved", "verified", "active"].includes(campaignStatus);

  const smsAllowed = approvedTopLevel || approvedNested;

  if (!smsAllowed) {
    console.log(`[AI-VOICE][SMS-CONFIRM] SMS confirmation skipped — A2P not approved for ${email}`, {
      topLevelA2p,
      brandStatus,
      campaignStatus,
      agentTimeZone,
    });
    return res.status(200).json({ ok: true, smsSent: false });
  }

  const to = normalizePhone(leadPhone);
  const safeAgentName = String(agentName || user?.firstName || user?.name || "your agent").trim() || "your agent";
  const whenStr = formatAppointmentTime(appointmentTime, leadTimeZone);

  const body =
    `Hi there! This is a confirmation that your appointment with ${safeAgentName} is scheduled. ` +
    `We'll call you at this number around ${whenStr}. Reply STOP to opt out.`;

  try {
    await sendSms({
      to,
      body,
      userEmail: email,
      leadId: leadId ? String(leadId) : undefined,
    });

    return res.status(200).json({ ok: true, smsSent: true });
  } catch (err: any) {
    console.warn("[AI-VOICE][SMS-CONFIRM] send failed:", err?.message || err);
    return res.status(200).json({ ok: true, smsSent: false });
  }
}
