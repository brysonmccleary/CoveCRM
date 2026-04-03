export type AIPriorityCategory = "hot" | "warm" | "cold";

export type PriorityScoreResult = {
  score: number;
  category: AIPriorityCategory;
  reason: string;
};

export type PriorityScoreInput = {
  lead?: any;
  latestInboundMessage?: any | null;
  latestCallLog?: any | null;
  latestCall?: any | null;
  memoryProfile?: any | null;
  memoryFacts?: any[] | null;
  attemptCount?: number;
  now?: Date;
};

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const VERY_OLD_LEAD_MS = 30 * ONE_DAY_MS;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function asDate(value: any): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asText(value: any): string {
  return String(value || "").trim();
}

function lower(value: any): string {
  return asText(value).toLowerCase();
}

function includesPattern(values: any[], pattern: RegExp) {
  return values.some((value) => pattern.test(asText(value)));
}

function normalizeStatus(value: any) {
  return lower(value).replace(/[_-]+/g, " ");
}

export function calculatePriorityScore(input: PriorityScoreInput): PriorityScoreResult {
  const now = input.now instanceof Date ? input.now : new Date();
  const lead = input.lead || {};
  const profile = input.memoryProfile || {};
  const facts = Array.isArray(input.memoryFacts) ? input.memoryFacts : [];
  const latestInboundMessage = input.latestInboundMessage || null;
  const latestCallLog = input.latestCallLog || null;
  const latestCall = input.latestCall || null;
  const attemptCount = Number(input.attemptCount || 0);

  const createdAt = asDate(lead.createdAt);
  const leadAgeMs = createdAt ? Math.max(0, now.getTime() - createdAt.getTime()) : Number.POSITIVE_INFINITY;
  const leadStatus = normalizeStatus(lead.status);
  const nextBestAction = lower(profile.nextBestAction);
  const objections = Array.isArray(profile.objections) ? profile.objections.map((item: any) => asText(item)).filter(Boolean) : [];

  const factPairs = facts.map((fact) => ({
    key: lower(fact?.key),
    value: asText(fact?.value),
  }));

  const textSignals = [
    latestInboundMessage?.text,
    profile.shortSummary,
    profile.longSummary,
    profile.nextBestAction,
    ...objections,
    ...factPairs.map((fact) => fact.value),
    ...(Array.isArray(latestCall?.aiOverview?.questions) ? latestCall.aiOverview.questions : []),
    ...(Array.isArray(latestCall?.aiOverview?.objections) ? latestCall.aiOverview.objections : []),
    ...(Array.isArray(latestCall?.aiOverview?.overviewBullets) ? latestCall.aiOverview.overviewBullets : []),
    ...(Array.isArray(latestCall?.aiOverview?.keyDetails) ? latestCall.aiOverview.keyDetails : []),
    ...(Array.isArray(latestCall?.aiOverview?.nextSteps) ? latestCall.aiOverview.nextSteps : []),
    latestCall?.aiSummary,
    latestCall?.transcript,
  ].filter(Boolean);

  let rawScore = 0;
  const reasons: string[] = [];

  const add = (points: number, reason: string) => {
    rawScore += points;
    reasons.push(`${points > 0 ? "+" : ""}${points} ${reason}`);
  };

  if (leadAgeMs < TEN_MINUTES_MS) add(30, "new lead under 10 minutes");
  else if (leadAgeMs < ONE_HOUR_MS) add(20, "new lead under 1 hour");
  else if (leadAgeMs < ONE_DAY_MS) add(10, "new lead under 24 hours");

  const repliedToSms = !!latestInboundMessage;
  if (repliedToSms) add(25, "replied to SMS");

  const answeredCall =
    normalizeStatus(latestCall?.answeredBy).includes("human") ||
    normalizeStatus(latestCallLog?.status).includes("connected") ||
    (Number(latestCall?.duration || latestCall?.durationSec || latestCallLog?.durationSeconds || 0) > 0 &&
      !latestCall?.isVoicemail);
  if (answeredCall) add(30, "answered call");

  const missedCall =
    /no answer|no_answer|busy|missed|voicemail/.test(normalizeStatus(latestCallLog?.status)) ||
    /no answer|voicemail/.test(normalizeStatus(latestCall?.aiOverview?.outcome)) ||
    latestCall?.isVoicemail === true;
  if (missedCall) add(10, "missed call");

  const askedQuestion =
    includesPattern([latestInboundMessage?.text], /\?/) ||
    (Array.isArray(latestCall?.aiOverview?.questions) && latestCall.aiOverview.questions.length > 0);
  if (askedQuestion) add(15, "asked a question");

  const askedAboutPrice =
    includesPattern(
      textSignals,
      /\b(price|cost|premium|payment|payments|monthly|rate|rates|how much)\b/i
    ) || includesPattern(objections, /\bprice\b/i);
  if (askedAboutPrice) add(20, "asked about price");

  const requestedCallback =
    factPairs.some((fact) => fact.key === "callback_time" && fact.value) ||
    /\bcallback\b/.test(normalizeStatus(latestCall?.aiOverview?.outcome)) ||
    includesPattern(textSignals, /\b(call|text)\s+me\s+back\b|\bcallback\b|\bcall me later\b/i);
  if (requestedCallback) add(25, "requested callback");

  const previouslyInterested =
    factPairs.some(
      (fact) =>
        fact.key === "appointment_intent" && /\b(interested|book|schedule|quote)\b/i.test(fact.value)
    ) || includesPattern(textSignals, /\b(interested|book|booking|schedule|quote|coverage|move forward)\b/i);
  if (previouslyInterested) add(20, "previously interested");

  const hasObjections =
    objections.length > 0 || factPairs.some((fact) => fact.key === "objection" && fact.value);
  if (hasObjections) add(5, "has objections logged");

  if (/\bcall\b/.test(nextBestAction)) add(10, "next best action is call");

  const notInterested =
    /\bnot interested\b/.test(leadStatus) ||
    /\bnot interested\b/.test(normalizeStatus(latestCall?.aiOverview?.outcome)) ||
    includesPattern(textSignals, /\bnot interested\b/i);
  if (notInterested) add(-40, "not interested");

  const badNumber =
    /\bbad number\b|\bwrong number\b|\bdisconnected\b/.test(leadStatus) ||
    lead?.badNumber === true;
  if (badNumber) add(-80, "bad number");

  if (attemptCount >= 5 && !repliedToSms && !answeredCall) {
    add(-20, "no response after many attempts");
  }

  if (leadAgeMs >= VERY_OLD_LEAD_MS) add(-10, "very old lead");

  const score = clamp(rawScore, 0, 100);
  const category: AIPriorityCategory = score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";
  const reason = reasons.length ? reasons.slice(0, 5).join("; ") : "No strong priority signals";

  return { score, category, reason };
}

export default calculatePriorityScore;
