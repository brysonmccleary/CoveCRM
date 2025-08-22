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

/**
 * Return ONLY the user's Twilio-owned DIDs (not personal/agent mobiles)
 */
function collectOwnedTwilioNumbers(user: any): string[] {
  const raw: string[] = uniq([
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

  const { leadId, allowSelfDial } = req.body || {};
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

  // Exclude ONLY Twilio-owned numbers (so you can still test by calling your own cell)
  const ownedDIDs = collectOwnedTwilioNumbers(user);
  const excludedSet = new Set<string>([fromNumber, ...ownedDIDs].map(e164));

  // Candidate lead phones
  const rawCandidates = extractLeadPhones(lead).map(e164);
  const filtered = rawCandidates.filter((n) => !excludedSet.has(n));

  // Optional override to allow dialing anything (for testing)
  const allowOverride = Boolean(allowSelfDial) || process.env.ALLOW_SELF_DIAL === "1";

  const finalCandidates = filtered.length > 0 ? filtered : (allowOverride ? rawCandidates : []);
  if (finalCandidates.length === 0) {
    console.warn("🚫 Refusing to dial: all candidate numbers are excluded (Twilio-owned).", {
      leadId,
      rawCandidates,
      excluded: Array.from(excludedSet),
    });
    return res.status(422).json({
      message: "Lead has no dialable number (appears to match your Twilio-owned numbers).",
      blockedCandidates: rawCandidates,
    });
  }

  // Pick first resolved number. Still avoid dialing the exact from DID.
  const toLead = finalCandidates.find((n) => n && n !== fromNumber) || finalCandidates[0];
  if (!toLead || toLead === fromNumber) {
    return res.status(422).json({ message: "Resolved lead number is invalid or equals caller ID." });
  }

  // Use a conference so the browser can hear the real greeting/beep
  const conferenceName = `ds-${leadId}-${Date.now().toString(36)}`;

  try {
    const twimlUrl = `${BASE_URL}/api/voice/lead-join?conferenceName=${encodeURIComponent(conferenceName)}`;

    // Build as `any` so newer AMD fields don't trip older SDK typings
    const createOpts: any = {
      to: toLead,
      from: fromNumber,
      url: twimlUrl,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      // Safe AMD (no advanced tuning to avoid 500s)
      machineDetection: "DetectMessageEnd",
      amdStatusCallback: `${BASE_URL}/api/twilio/amd-callback`,
      amdStatusCallbackMethod: "POST",
    };

    const call = await twilioClient.calls.create(createOpts);

    // Persist mapping so webhooks & client can correlate
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
          conferenceName,
        },
      },
      { upsert: true },
    );

    console.log("📞 voice/call placed (conference lead-only)", {
      from: fromNumber,
      toLead,
      callSid: call.sid,
      conferenceName,
      excludedOwnedDIDs: Array.from(excludedSet),
      rawCandidates,
      finalCandidates,
    });

    // Return conferenceName so the browser can join via WebRTC
    return res.status(200).json({
      success: true,
      callSid: call.sid,
      toLead,
      from: fromNumber,
      conferenceName,
    });
  } catch (err: any) {
    console.error("❌ voice/call error:", err?.message || err);
    return res.status(500).json({ message: "Failed to initiate call", error: err?.message });
  }
}
