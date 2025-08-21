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
  if (!d) return "";
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

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function collectAgentNumbers(user: any): string[] {
  const raw: string[] = uniq([
    user?.agentPhone,
    user?.phone,
    user?.personalPhone,
    user?.profile?.phone,
    user?.profile?.agentPhone,
    ...(Array.isArray(user?.numbers) ? user.numbers.map((n: any) => n?.phoneNumber) : []),
    process.env.TWILIO_CALLER_ID || "",
  ]);
  return uniq(raw.map((x) => e164(String(x || ""))));
}

function extractLeadPhones(lead: any): string[] {
  const candidates: string[] = [];

  const pushIfPhoneLike = (val: any) => {
    if (!val) return;
    if (typeof val === "string") {
      const n = e164(val);
      if (n.length >= 11) candidates.push(n);
    } else if (Array.isArray(val)) {
      val.forEach((v) => pushIfPhoneLike(v));
    }
  };

  // 1) Priority common fields
  const priorityKeys = [
    "phone",
    "Phone",
    "mobile",
    "Mobile",
    "cell",
    "Cell",
    "workPhone",
    "homePhone",
    "Phone Number",
    "phone_number",
    "primaryPhone",
    "contactNumber",
  ];
  priorityKeys.forEach((k) => pushIfPhoneLike(lead?.[k]));

  // 2) Any field that *sounds* like phone/number
  Object.entries(lead || {}).forEach(([k, v]) => {
    const kl = k.toLowerCase();
    if (kl.includes("phone") || kl.includes("mobile") || kl.includes("cell") || kl.includes("number")) {
      pushIfPhoneLike(v);
    }
  });

  return uniq(candidates);
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

  // ---- Resolve FROM number (your Twilio DID)
  const ownedNumbers: any[] = Array.isArray((user as any).numbers) ? (user as any).numbers : [];
  const fromNumber = e164(
    ownedNumbers?.[0]?.phoneNumber ||
      process.env.TWILIO_CALLER_ID ||
      ""
  );
  if (!fromNumber) {
    return res.status(400).json({ message: "No Twilio number on account (fromNumber)" });
  }

  // ---- Resolve the LEAD phone robustly, excluding agent/personal numbers
  const agentNumbers = collectAgentNumbers(user);
  const leadPhoneCandidates = extractLeadPhones(lead).filter(Boolean);

  // Prefer the first candidate that is NOT an agent/personal number
  let leadPhone = leadPhoneCandidates.find((n) => !agentNumbers.includes(n)) || "";
  // Fallback to first candidate if all were excluded
  if (!leadPhone) leadPhone = leadPhoneCandidates[0] || "";

  if (!leadPhone) {
    return res.status(400).json({ message: "Lead has no phone number" });
  }

  // Safety: never allow FROM == TO
  if (leadPhone === fromNumber) {
    // If the first is identical to from, try another candidate
    const alt = leadPhoneCandidates.find((n) => n !== fromNumber);
    if (alt) leadPhone = alt;
  }
  if (leadPhone === fromNumber) {
    return res.status(400).json({ message: "Lead phone equals caller ID; cannot place call" });
  }

  // ❗ No agent PSTN leg — only:
  // 1) PSTN call to the LEAD
  // 2) Optional agent "web leg" to Twilio Client (never your cell)
  const clientIdentity = identityFromEmail(userEmail);
  const conferenceName = `ds-${leadId}-${Date.now().toString(36)}`;

  try {
    const leadJoinUrl = `${BASE_URL}/api/voice/lead-join?conferenceName=${encodeURIComponent(
      conferenceName,
    )}`;
    const agentJoinUrl = `${BASE_URL}/api/voice/agent-join?conferenceName=${encodeURIComponent(
      conferenceName,
    )}`;

    // 1) Lead PSTN leg (with AMD-on-create; TwiML will handle conference join)
    const leadCall = await twilioClient.calls.create({
      to: leadPhone,
      from: fromNumber,
      url: leadJoinUrl,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      machineDetection: "DetectMessageEnd" as any,
    });

    // 2) Agent "web" leg — Twilio Client identity (cannot ring your cell)
    const agentCall = await twilioClient.calls.create({
      to: `client:${clientIdentity}`,
      from: fromNumber,
      url: agentJoinUrl,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    // Helpful server log (check in Vercel)
    console.log("voice/call placed", {
      from: fromNumber,
      toLead: leadPhone,
      toAgentClient: `client:${clientIdentity}`,
      conferenceName,
      leadCallSid: leadCall.sid,
      agentCallSid: agentCall.sid,
      excludedAgentNumbers: agentNumbers,
      leadCandidates: leadPhoneCandidates,
    });

    // Client expects a callSid — return the lead call SID
    return res.status(200).json({
      success: true,
      callSid: leadCall.sid,
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
