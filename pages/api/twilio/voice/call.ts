// /pages/api/twilio/voice/call.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import twilioClient from "@/lib/twilioClient";
import Lead from "@/models/Lead";
import { getUserByEmail } from "@/models/User";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  ""
).replace(/\/$/, "");

function e164(num: string) {
  if (!num) return "";
  const d = num.replace(/\D+/g, "");
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (num.startsWith("+")) return num.trim();
  return `+${d}`;
}

function identityFromEmail(email: string) {
  return String(email || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 120);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  const { leadId } = req.body || {};
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  await dbConnect();

  const userEmail = String(session.user.email).toLowerCase();
  const user = await getUserByEmail(userEmail);
  if (!user) return res.status(404).json({ message: "User not found" });

  const lead: any = await Lead.findOne({ _id: leadId, userEmail }).lean();
  if (!lead) return res.status(404).json({ message: "Lead not found" });

  const leadPhone = e164(lead.Phone || lead.phone || "");
  if (!leadPhone) return res.status(400).json({ message: "Lead has no phone number" });

  // Resolve FROM Twilio DID from user profile (numbers array) or fallback env
  const ownedNumbers: any[] = Array.isArray((user as any).numbers) ? (user as any).numbers : [];
  const fromNumber = e164(
    ownedNumbers?.[0]?.phoneNumber ||
      process.env.TWILIO_CALLER_ID ||
      ""
  );
  if (!fromNumber) {
    return res.status(400).json({ message: "No Twilio number on account (fromNumber)" });
  }

  // ❗ Absolutely no agent PSTN leg — only:
  // 1) PSTN call to the LEAD
  // 2) Optional agent "web leg" to Twilio Client (never your cell)
  const clientIdentity = identityFromEmail(userEmail);
  const conferenceName = `ds-${leadId}-${Date.now().toString(36)}`;

  try {
    // Lead leg (PSTN) — joins conference; enable AMD (DetectMessageEnd)
    const leadJoinUrl = `${BASE_URL}/api/voice/lead-join?conferenceName=${encodeURIComponent(
      conferenceName,
    )}`;

    const leadCall = await twilioClient.calls.create({
      to: leadPhone,
      from: fromNumber,
      url: leadJoinUrl,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      // AMD on create: OK to keep DetectMessageEnd (no extra callback props here)
      machineDetection: "DetectMessageEnd" as any,
    });

    // Agent "web" leg (Twilio Client) — this will NOT dial your phone
    const agentJoinUrl = `${BASE_URL}/api/voice/agent-join?conferenceName=${encodeURIComponent(
      conferenceName,
    )}`;

    const agentCall = await twilioClient.calls.create({
      to: `client:${clientIdentity}`,
      from: fromNumber,
      url: agentJoinUrl,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    return res.status(200).json({
      success: true,
      conferenceName,
      leadCallSid: leadCall.sid,
      agentCallSid: agentCall.sid,
      toLead: leadPhone,
      from: fromNumber,
      toAgentClient: `client:${clientIdentity}`,
    });
  } catch (err: any) {
    console.error("❌ voice/call error:", err?.message || err);
    return res.status(500).json({ message: "Failed to initiate call", error: err?.message });
  }
}
