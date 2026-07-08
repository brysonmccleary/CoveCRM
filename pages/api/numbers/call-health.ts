import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Call from "@/models/Call";
import {
  computeAnswerRate,
  computeShortCallRate,
  classifyNumber,
  median,
  type ReputationTier,
} from "@/lib/reputation/numberReputation";

type HealthLabel = "Healthy" | "Watch" | "Spam Risk" | "Unknown";

type CallHealthRow = {
  phoneNumber: string;
  label: HealthLabel;
  score: number;
  lastCheckedAt: string | null;
  providerSpamSignal: boolean;
  answerRate: number | null;
  shortCallRate: number | null;
  outboundVolume7d: number;
  inboundVolume7d: number;
  flags: string[];
  recommendations: string[];
};

function normalizePhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(value || "").trim().startsWith("+")) return `+${digits}`;
  return digits;
}

function toDateMs(value: unknown): number {
  if (!value) return 0;
  const time = new Date(value as any).getTime();
  return Number.isFinite(time) ? time : 0;
}

function callTime(call: any): number {
  return Math.max(toDateMs(call.completedAt), toDateMs(call.startedAt), toDateMs(call.createdAt));
}

function callDuration(call: any): number {
  const duration = Number(call.durationSec ?? call.duration ?? call.talkTime ?? 0);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function buildHealthForNumber(args: {
  phoneNumber: string;
  calls: any[];
  now: number;
  peerMedian: number | null;
  fleetSize: number;
}): CallHealthRow {
  const { phoneNumber, calls, now, peerMedian, fleetSize } = args;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const normalized = normalizePhone(phoneNumber);
  const providerSpamSignal = false;
  const outbound7d = calls.filter((call) => {
    if (callTime(call) < sevenDaysAgo) return false;
    const owner = normalizePhone(call.ownerNumber || call.from);
    return String(call.direction || "outbound") === "outbound" && owner === normalized;
  });
  const inbound7d = calls.filter((call) => {
    if (callTime(call) < sevenDaysAgo) return false;
    const owner = normalizePhone(call.ownerNumber || call.to);
    return String(call.direction || "") === "inbound" && owner === normalized;
  });

  const outboundVolume7d = outbound7d.length;
  const inboundVolume7d = inbound7d.length;
  const outbound24h = outbound7d.filter((call) => callTime(call) >= oneDayAgo).length;
  const voicemailCalls = outbound7d.filter((call) => call.isVoicemail === true).length;
  const completedTalkCalls = outbound7d.filter((call) => {
    if (call.isVoicemail === true) return false;
    return Boolean(call.completedAt) && callDuration(call) > 0;
  }).length;
  const veryShortCalls = outbound7d.filter((call) => {
    if (call.isVoicemail === true) return false;
    const duration = callDuration(call);
    return Boolean(call.completedAt) && duration > 0 && duration < 5;
  }).length;

  const answerRate = computeAnswerRate({
    completed: completedTalkCalls,
    voicemail: voicemailCalls,
    total: outboundVolume7d,
  });
  const shortCallRate = computeShortCallRate({
    answeredUnder5s: veryShortCalls,
    answered: completedTalkCalls,
  });
  const classification = classifyNumber({
    answerRate,
    shortCallRate,
    peerMedian,
    dials: outboundVolume7d,
    fleetSize,
  });

  const flags: string[] = [];
  const recommendations: string[] = [];
  let score = scoreForTier(classification.tier);

  if (classification.tier === "insufficient_data") {
    flags.push("Insufficient recent outbound call data");
    recommendations.push("Call health is based on limited data until this number has more completed call history.");
  } else if (classification.tier === "spam_risk") {
    flags.push("High unanswered call pattern");
    recommendations.push("Slow down volume and review lead quality or call timing before increasing usage.");
  } else if (classification.tier === "watch") {
    flags.push("Elevated unanswered call pattern");
    recommendations.push("Watch this number closely and keep call volume steady.");
  }

  if (classification.reasons.some((reason) => reason.startsWith("high_short_call_rate"))) {
    flags.push("Elevated short-call pattern");
    recommendations.push("Monitor for quick hangups and avoid sudden volume increases.");
  }

  if (outbound24h >= 30 && outbound24h >= Math.max(12, Math.ceil(outboundVolume7d * 0.6))) {
    flags.push("Sudden outbound volume spike");
    recommendations.push("Keep daily volume gradual to protect call reputation.");
    score = Math.max(score, 55);
  }

  if (!recommendations.length) {
    recommendations.push("Keep call volume consistent and monitor answer quality over time.");
  }

  const label = labelForTier(classification.tier);

  return {
    phoneNumber,
    label,
    score: Math.max(0, Math.min(100, Math.round(score))),
    lastCheckedAt: null,
    providerSpamSignal,
    answerRate,
    shortCallRate,
    outboundVolume7d,
    inboundVolume7d,
    flags,
    recommendations,
  };
}

function labelForTier(tier: ReputationTier): HealthLabel {
  if (tier === "spam_risk") return "Spam Risk";
  if (tier === "watch") return "Watch";
  if (tier === "insufficient_data") return "Unknown";
  return "Healthy";
}

function scoreForTier(tier: ReputationTier): number {
  if (tier === "spam_risk") return 80;
  if (tier === "watch") return 55;
  return 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const userEmail = session.user.email.toLowerCase();

  await mongooseConnect();

  const user = await User.findOne({ email: userEmail }).select("email numbers").exec();
  if (!user) return res.status(200).json({ health: [] });

  const numbers: string[] = ((user as any).numbers || [])
    .map((num: any) => String(num?.phoneNumber || "").trim())
    .filter(Boolean);

  if (!numbers.length) return res.status(200).json({ health: [] });

  const normalizedNumbers = new Set(numbers.map(normalizePhone).filter(Boolean));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const callRows = await (Call as any)
    .find({
      userEmail,
      $or: [
        { startedAt: { $gte: thirtyDaysAgo } },
        { completedAt: { $gte: thirtyDaysAgo } },
        { createdAt: { $gte: thirtyDaysAgo } },
      ],
    })
    .select("direction ownerNumber otherNumber from to startedAt completedAt createdAt duration durationSec talkTime answeredBy isVoicemail")
    .lean();

  const relevantCalls = (callRows as any[]).filter((call) => {
    const owner = normalizePhone(call.ownerNumber || call.from || call.to);
    return normalizedNumbers.has(owner);
  });

  const now = Date.now();
  const answerRates = numbers.map((phoneNumber) => {
    const normalized = normalizePhone(phoneNumber);
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const outbound7d = relevantCalls.filter((call) => {
      const owner = normalizePhone(call.ownerNumber || call.from);
      return callTime(call) >= sevenDaysAgo && String(call.direction || "outbound") === "outbound" && owner === normalized;
    });
    const completed = outbound7d.filter((call) => call.isVoicemail !== true && Boolean(call.completedAt) && callDuration(call) > 0).length;
    const voicemail = outbound7d.filter((call) => call.isVoicemail === true).length;
    return computeAnswerRate({ completed, voicemail, total: outbound7d.length });
  });
  const fleetMedian = median(answerRates);
  const health = numbers.map((phoneNumber) =>
    buildHealthForNumber({
      phoneNumber,
      calls: relevantCalls,
      now,
      peerMedian: fleetMedian,
      fleetSize: numbers.length,
    }),
  );

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ health });
}
