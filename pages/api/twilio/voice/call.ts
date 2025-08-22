// /pages/api/twilio/voice/call.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import twilioClient from "@/lib/twilioClient";
import Lead from "@/models/Lead";
import { getUserByEmail } from "@/models/User";
import Call from "@/models/Call";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");

function e164(num: string) {
  if (!num) return "";
  const d = num.replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (num.startsWith("+")) return num.trim();
  return `+${d}`;
}
function uniq<T>(arr: T[]) { return Array.from(new Set(arr.filter(Boolean))); }

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
  const out: string[] = [];
  const pushIfPhone = (val: any) => {
    if (!val) return;
    if (typeof val === "string") {
      const n = e164(val);
      if (n.length >= 11) out.push(n);
    } else if (Array.isArray(val)) {
      val.forEach(pushIfPhone);
    }
  };

  const priority = [
    "phone","Phone","mobile","Mobile","cell","Cell",
    "workPhone","homePhone","Phone Number","phone_number",
    "primaryPhone","contactNumber"
  ];
  priority.forEach((k) => pushIfPhone(lead?.[k]));

  Object.entries(lead || {}).forEach(([k, v]) => {
    const kl = k.toLowerCase();
    if (kl.includes("phone") || kl.includes("mobile") || kl.includes("cell") || kl.includes("number")) {
      pushIfPhone(v);
    }
  });

  return uniq(out);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { leadId } = req.body || {};
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  await dbConnect();

  const userEmail = String(session.user.email).toLowerCase();
  const user = await getUserByEmail(userEmail);
  if (!user) return res.status(404).json({ message: "User not found" });

  const lead: any = await Lead.findOne({ _id: leadId, userEmail }).lean();
  if (!lead) return res.status(404).json({ message: "Lead not found" });

  // FROM = your Twilio DID (must be one you own)
  const ownedNumbers: any[] = Array.isArray((user as any).numbers) ? (user as any).numbers : [];
  const fromNumber = e164(ownedNumbers?.[0]?.phoneNumber || process.env.TWILIO_CALLER_ID || "");
  if (!fromNumber) return res.status(400).json({ message: "No Twilio number on account (fromNumber)" });

  // Build excluded set: all agent/owned numbers + from DID
  const agentNumbers = collectAgentNumbers(user);
  const excluded = new Set<string>([fromNumber, ...agentNumbers].map(e164));

  // Gather candidate lead phones, then strictly filter out excluded numbers
  const rawCandidates = extractLeadPhones(lead);
  const candidates = rawCandidates.filter((n) => !excluded.has(e164(n)));

  if (candidates.length === 0) {
    console.warn("🚫 Refusing to dial: all candidate numbers are excluded (agent/from).", {
      leadId,
      rawCandidates,
      excluded: Array.from(excluded),
    });
    return res.status(422).json({
      message: "Lead has no dialable number (appears to match your agent/from numbers).",
      blockedCandidates: rawCandidates,
    });
  }

  const toLead = e164(candidates[0]);
  if (!toLead || toLead === fromNumber || excluded.has(toLead)) {
    return res.status(422).json({ message: "Resolved lead number is invalid or excluded." });
  }

  try {
    // We park the call silently and let AMD drive behavior.
    const twimlUrl = `${BASE_URL}/api/voice/lead-park`;

    const call = await twilioClient.calls.create({
      to: toLead,
      from: fromNumber,
      url: twimlUrl,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      // AMD with beep detection (+ faster tuning to reduce "carrier music" window)
      machineDetection: "DetectMessageEnd" as any,
      machineDetectionTimeout: 10,
      machineDetectionSpeechThreshold: 1000,
      machineDetectionSpeechEndThreshold: 150,
      machineDetectionSilenceTimeout: 500,
      amdStatusCallback: `${BASE_URL}/api/twilio/amd-callback`,
      amdStatusCallbackMethod: "POST",
    });

    // Immediately persist the mapping so all webhooks can disposition this call
    await Call.updateOne(
      { callSid: call.sid },
      {
        $setOnInsert: {
          callSid: call.sid,
          userEmail,
          direction: "outbound",
          startedAt: new Date(),
        },
        $set: {
          leadId,
          ownerNumber: fromNumber,
          otherNumber: toLead,
        },
      },
      { upsert: true },
    );

    console.log("📞 voice/call placed (lead-only)", {
      from: fromNumber,
      toLead,
      callSid: call.sid,
      excludedAgentNumbers: Array.from(excluded),
      rawCandidates,
      chosenFromCandidates: candidates,
    });

    return res.status(200).json({ success: true, callSid: call.sid, toLead, from: fromNumber });
  } catch (err: any) {
    console.error("❌ voice/call error:", err?.message || err);
    return res.status(500).json({ message: "Failed to initiate call", error: err?.message });
  }
}
