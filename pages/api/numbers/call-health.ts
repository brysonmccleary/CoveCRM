import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Call from "@/models/Call";
import NumberSpamStatus from "@/models/NumberSpamStatus";

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

function roundPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
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

function hasProviderSpamSignal(spam: any): boolean {
  const score = Number(spam?.spamScore || 0);
  const label = String(spam?.spamLabel || "").toLowerCase();
  return Boolean(spam?.isSpam) || score >= 75 || /\b(spam|scam|fraud)\b/.test(label);
}

function buildHealthForNumber(args: {
  phoneNumber: string;
  spam: any;
  calls: any[];
  now: number;
}): CallHealthRow {
  const { phoneNumber, spam, calls, now } = args;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const normalized = normalizePhone(phoneNumber);
  const providerSpamSignal = hasProviderSpamSignal(spam);
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
  const completedTalkCalls = outbound7d.filter((call) => callDuration(call) >= 20).length;
  const veryShortCalls = outbound7d.filter((call) => {
    const duration = callDuration(call);
    return duration > 0 && duration < 15;
  }).length;
  const zeroDurationCalls = outbound7d.filter((call) => callDuration(call) === 0).length;

  const answerRate = outboundVolume7d > 0 ? roundPct((completedTalkCalls / outboundVolume7d) * 100) : null;
  const shortCallRate =
    outboundVolume7d > 0 ? roundPct(((veryShortCalls + zeroDurationCalls) / outboundVolume7d) * 100) : null;

  const flags: string[] = [];
  const recommendations: string[] = [];
  let score = Number(spam?.spamScore || 0);

  if (providerSpamSignal) {
    flags.push("Provider spam signal detected");
    recommendations.push("Review this number before high-volume calling. Consider checking reputation with your provider.");
    score = Math.max(score, 90);
  }

  if (!spam?.checkedAt) {
    flags.push("No provider spam check cached");
    recommendations.push("Run a provider spam check before relying on this number for higher-volume calling.");
  }

  if (outboundVolume7d < 5) {
    flags.push("Insufficient recent outbound call data");
    recommendations.push("Call health is based on limited data until this number has more completed call history.");
  }

  if (outboundVolume7d >= 10 && answerRate !== null && answerRate < 20) {
    flags.push("High unanswered call pattern");
    recommendations.push("Slow down volume and review lead quality or call timing before increasing usage.");
    score = Math.max(score, 70);
  } else if (outboundVolume7d >= 10 && answerRate !== null && answerRate < 35) {
    flags.push("Elevated unanswered call pattern");
    recommendations.push("Watch this number closely and keep call volume steady.");
    score = Math.max(score, 50);
  }

  if (outboundVolume7d >= 10 && shortCallRate !== null && shortCallRate >= 70) {
    flags.push("Severe short-call pattern");
    recommendations.push("Review call opening, lead source quality, and call timing before scaling volume.");
    score = Math.max(score, 75);
  } else if (outboundVolume7d >= 10 && shortCallRate !== null && shortCallRate >= 45) {
    flags.push("Elevated short-call pattern");
    recommendations.push("Monitor for quick hangups and avoid sudden volume increases.");
    score = Math.max(score, 50);
  }

  if (outbound24h >= 30 && outbound24h >= Math.max(12, Math.ceil(outboundVolume7d * 0.6))) {
    flags.push("Sudden outbound volume spike");
    recommendations.push("Keep daily volume gradual to protect call reputation.");
    score = Math.max(score, 55);
  }

  if (!recommendations.length) {
    recommendations.push("Keep call volume consistent and monitor answer quality over time.");
  }

  let label: HealthLabel = "Healthy";
  if (providerSpamSignal || score >= 75) label = "Spam Risk";
  else if (!spam?.checkedAt || outboundVolume7d < 5) label = "Unknown";
  else if (score >= 40 || flags.length > 0) label = "Watch";

  return {
    phoneNumber,
    label,
    score: Math.max(0, Math.min(100, Math.round(score))),
    lastCheckedAt: spam?.checkedAt ? new Date(spam.checkedAt).toISOString() : null,
    providerSpamSignal,
    answerRate,
    shortCallRate,
    outboundVolume7d,
    inboundVolume7d,
    flags,
    recommendations,
  };
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

  const [spamRows, callRows] = await Promise.all([
    NumberSpamStatus.find({ userEmail, phoneNumber: { $in: numbers } }).lean(),
    (Call as any)
      .find({
        userEmail,
        $or: [
          { startedAt: { $gte: thirtyDaysAgo } },
          { completedAt: { $gte: thirtyDaysAgo } },
          { createdAt: { $gte: thirtyDaysAgo } },
        ],
      })
      .select("direction ownerNumber otherNumber from to startedAt completedAt createdAt duration durationSec talkTime answeredBy isVoicemail")
      .lean(),
  ]);

  const spamByNumber = new Map<string, any>();
  for (const spam of spamRows as any[]) {
    spamByNumber.set(normalizePhone(spam.phoneNumber), spam);
  }

  const relevantCalls = (callRows as any[]).filter((call) => {
    const owner = normalizePhone(call.ownerNumber || call.from || call.to);
    return normalizedNumbers.has(owner);
  });

  const now = Date.now();
  const health = numbers.map((phoneNumber) =>
    buildHealthForNumber({
      phoneNumber,
      spam: spamByNumber.get(normalizePhone(phoneNumber)),
      calls: relevantCalls,
      now,
    }),
  );

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ health });
}
