import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Call from "@/models/Call";
import AICallRecording from "@/models/AICallRecording";
import NumberSpamStatus from "@/models/NumberSpamStatus";
import { sendSupportEmail } from "@/lib/email/supportEmailProvider";
import { sendSms } from "@/lib/twilio/sendSMS";
import {
  computeAnswerRate,
  computeShortCallRate,
  classifyNumber,
  evaluateAlertTransition,
  formatReputationAlertCopy,
  median,
  MIN_DIALS_FOR_EVAL,
  type ReputationTier,
} from "@/lib/reputation/numberReputation";

type StatBucket = {
  total: number;
  completed: number;
  voicemail: number;
  answeredUnder5s: number;
};

type NumberEvaluation = {
  phoneNumber: string;
  tier: ReputationTier;
  answerRate: number | null;
  priorAnswerRate: number | null;
  shortCallRate: number | null;
  peerMedian: number | null;
  dials7d: number;
  reasons: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENT_WINDOW_DAYS = 7;
const PRIOR_WINDOW_DAYS = 7;

function isAuthorizedCron(req: NextApiRequest): boolean {
  const secret = process.env.VERCEL_CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  const hasBearer = !!secret && authHeader === `Bearer ${secret}`;
  const isVercelCron = !!req.headers["x-vercel-cron"];
  return hasBearer || isVercelCron;
}

function normalizePhone(value: unknown): string {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+")) return `+${digits}`;
  return digits;
}

function emptyBucket(): StatBucket {
  return { total: 0, completed: 0, voicemail: 0, answeredUnder5s: 0 };
}

function addBucket(target: StatBucket, source: Partial<StatBucket>) {
  target.total += Number(source.total || 0);
  target.completed += Number(source.completed || 0);
  target.voicemail += Number(source.voicemail || 0);
  target.answeredUnder5s += Number(source.answeredUnder5s || 0);
}

function mergeRows(rows: any[]): Map<string, StatBucket> {
  const out = new Map<string, StatBucket>();
  for (const row of rows || []) {
    const phoneNumber = normalizePhone(row?._id || row?.phoneNumber || row?.fromNumber || "");
    if (!phoneNumber) continue;
    const bucket = out.get(phoneNumber) || emptyBucket();
    addBucket(bucket, row);
    out.set(phoneNumber, bucket);
  }
  return out;
}

function bucketFor(map: Map<string, StatBucket>, phoneNumber: string): StatBucket {
  return map.get(normalizePhone(phoneNumber)) || emptyBucket();
}

function formatPhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length === 10) return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return phoneNumber;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function tierLabel(tier: ReputationTier): string {
  if (tier === "spam_risk") return "Spam Risk";
  if (tier === "watch") return "Watch";
  if (tier === "insufficient_data") return "Insufficient Data";
  return "Healthy";
}

async function aggregateCallBuckets(userEmail: string, start: Date, end: Date) {
  const rows = await (Call as any).aggregate([
    {
      $match: {
        userEmail,
        direction: "outbound",
        $or: [
          { startedAt: { $gte: start, $lt: end } },
          { completedAt: { $gte: start, $lt: end } },
          { createdAt: { $gte: start, $lt: end } },
        ],
      },
    },
    {
      $project: {
        fromNumber: { $ifNull: ["$ownerNumber", "$from"] },
        completedAt: 1,
        isVoicemail: 1,
        durationSec: { $ifNull: ["$durationSec", { $ifNull: ["$duration", "$talkTime"] }] },
      },
    },
    { $match: { fromNumber: { $nin: [null, ""] } } },
    {
      $group: {
        _id: "$fromNumber",
        total: { $sum: 1 },
        voicemail: { $sum: { $cond: [{ $eq: ["$isVoicemail", true] }, 1, 0] } },
        completed: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$completedAt", null] },
                  { $gt: ["$durationSec", 0] },
                  { $ne: ["$isVoicemail", true] },
                ],
              },
              1,
              0,
            ],
          },
        },
        answeredUnder5s: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$completedAt", null] },
                  { $gt: ["$durationSec", 0] },
                  { $lt: ["$durationSec", 5] },
                  { $ne: ["$isVoicemail", true] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  return mergeRows(rows);
}

async function aggregateAiRecordingBuckets(userEmail: string, start: Date, end: Date) {
  const rows = await (AICallRecording as any).aggregate([
    {
      $match: {
        userEmail,
        fromNumber: { $nin: [null, ""] },
        createdAt: { $gte: start, $lt: end },
      },
    },
    {
      $project: {
        fromNumber: 1,
        outcome: { $toLower: { $ifNull: ["$outcome", ""] } },
        lastTwilioStatus: { $toLower: { $ifNull: ["$lastTwilioStatus", ""] } },
        durationSec: { $ifNull: ["$durationSec", 0] },
      },
    },
    {
      $project: {
        fromNumber: 1,
        durationSec: 1,
        isVoicemail: { $eq: ["$outcome", "voicemail"] },
        isAnswered: {
          $or: [
            { $in: ["$outcome", ["booked", "callback", "not_interested", "do_not_call", "transferred"]] },
            { $and: [{ $eq: ["$lastTwilioStatus", "completed"] }, { $gt: ["$durationSec", 0] }] },
            {
              $and: [
                { $gt: ["$durationSec", 0] },
                { $not: [{ $in: ["$outcome", ["no_answer", "voicemail"]] }] },
              ],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: "$fromNumber",
        total: { $sum: 1 },
        voicemail: { $sum: { $cond: ["$isVoicemail", 1, 0] } },
        completed: { $sum: { $cond: [{ $and: ["$isAnswered", { $not: ["$isVoicemail"] }] }, 1, 0] } },
        answeredUnder5s: {
          $sum: {
            $cond: [
              { $and: ["$isAnswered", { $not: ["$isVoicemail"] }, { $gt: ["$durationSec", 0] }, { $lt: ["$durationSec", 5] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  return mergeRows(rows);
}

async function buildWindowBuckets(userEmail: string, start: Date, end: Date) {
  const [callBuckets, aiBuckets] = await Promise.all([
    aggregateCallBuckets(userEmail, start, end),
    aggregateAiRecordingBuckets(userEmail, start, end),
  ]);

  const merged = new Map<string, StatBucket>();
  for (const [phoneNumber, bucket] of callBuckets.entries()) {
    merged.set(phoneNumber, { ...bucket });
  }
  for (const [phoneNumber, bucket] of aiBuckets.entries()) {
    const existing = merged.get(phoneNumber) || emptyBucket();
    addBucket(existing, bucket);
    merged.set(phoneNumber, existing);
  }
  return merged;
}

function evaluateNumbers(args: {
  phoneNumbers: string[];
  current: Map<string, StatBucket>;
  prior: Map<string, StatBucket>;
}): NumberEvaluation[] {
  const base = args.phoneNumbers.map((phoneNumber) => {
    const current = bucketFor(args.current, phoneNumber);
    const prior = bucketFor(args.prior, phoneNumber);
    const answerRate = computeAnswerRate({
      completed: current.completed,
      voicemail: current.voicemail,
      total: current.total,
    });
    return {
      phoneNumber,
      current,
      prior,
      answerRate,
      priorAnswerRate: computeAnswerRate({
        completed: prior.completed,
        voicemail: prior.voicemail,
        total: prior.total,
      }),
      shortCallRate: computeShortCallRate({
        answeredUnder5s: current.answeredUnder5s,
        answered: current.completed,
      }),
    };
  });

  const peerMedian = median(
    base
      .filter((row) => row.current.total >= MIN_DIALS_FOR_EVAL)
      .map((row) => row.answerRate),
  );
  const fleetSize = base.filter((row) => row.current.total >= MIN_DIALS_FOR_EVAL).length;

  return base.map((row) => {
    const result = classifyNumber({
      answerRate: row.answerRate,
      priorAnswerRate: row.priorAnswerRate,
      shortCallRate: row.shortCallRate,
      peerMedian,
      dials: row.current.total,
      fleetSize,
    });
    return {
      phoneNumber: row.phoneNumber,
      tier: result.tier,
      answerRate: row.answerRate,
      priorAnswerRate: row.priorAnswerRate,
      shortCallRate: row.shortCallRate,
      peerMedian,
      dials7d: row.current.total,
      reasons: result.reasons,
    };
  });
}

async function sendReputationAlert(args: {
  user: any;
  evaluation: NumberEvaluation;
}) {
  const userEmail = String(args.user?.email || "").toLowerCase();
  const agentPhone = normalizePhone(args.user?.agentPhone || "");
  const formatted = formatPhone(args.evaluation.phoneNumber);
  const body = formatReputationAlertCopy({
    tier: args.evaluation.tier,
    formattedNumber: formatted,
  });
  const subject = `CoveCRM number reputation: ${tierLabel(args.evaluation.tier)}`;

  try {
    const emailResult = await sendSupportEmail({
      to: userEmail,
      subject,
      body,
      html: `<p>${htmlEscape(body)}</p>`,
    });
    if (!(emailResult as any)?.ok) {
      console.warn("[number-reputation] email alert failed", {
        userEmail,
        phoneNumber: args.evaluation.phoneNumber,
        result: emailResult,
      });
    }
  } catch (err: any) {
    console.warn("[number-reputation] email alert threw", {
      userEmail,
      phoneNumber: args.evaluation.phoneNumber,
      error: err?.message || String(err),
    });
  }

  if (!agentPhone) {
    console.warn("[number-reputation] no agentPhone set, SMS alert skipped", {
      userEmail,
      phoneNumber: args.evaluation.phoneNumber,
    });
    return;
  }

  try {
    await sendSms({
      to: agentPhone,
      body,
      userEmail,
      source: "manual",
      idempotencyKey: `number-reputation:${userEmail}:${args.evaluation.phoneNumber}:${args.evaluation.tier}`,
    });
  } catch (err: any) {
    console.warn("[number-reputation] sms alert failed", {
      userEmail,
      phoneNumber: args.evaluation.phoneNumber,
      error: err?.message || String(err),
    });
  }
}

async function persistEvaluation(args: {
  user: any;
  evaluation: NumberEvaluation;
  now: Date;
}) {
  const userEmail = String(args.user?.email || "").toLowerCase();
  const existing = await (NumberSpamStatus as any)
    .findOne({ userEmail, phoneNumber: args.evaluation.phoneNumber })
    .lean();
  const transition = evaluateAlertTransition({
    previousTier: existing?.tier || null,
    nextTier: args.evaluation.tier,
    lastAlertTier: existing?.lastAlertTier || null,
  });

  if (transition.shouldAlert) {
    await sendReputationAlert(args);
  }

  const isSpam = args.evaluation.tier === "spam_risk";
  const isFlagged = args.evaluation.tier === "watch" || args.evaluation.tier === "spam_risk";
  const set: any = {
    userEmail,
    phoneNumber: args.evaluation.phoneNumber,
    tier: args.evaluation.tier,
    spamScore: isSpam ? 90 : args.evaluation.tier === "watch" ? 50 : 0,
    spamLabel: isSpam ? "Spam Risk" : args.evaluation.tier === "watch" ? "Watch" : "Healthy",
    isSpam,
    answerRate: args.evaluation.answerRate,
    priorAnswerRate: args.evaluation.priorAnswerRate,
    shortCallRate: args.evaluation.shortCallRate,
    peerMedian: args.evaluation.peerMedian,
    dials7d: args.evaluation.dials7d,
    reasons: args.evaluation.reasons,
    checkedAt: args.now,
    rawResponse: {
      provider: "covecrm_call_data",
      source: "nightly_number_reputation",
      currentWindowDays: CURRENT_WINDOW_DAYS,
      priorWindowDays: PRIOR_WINDOW_DAYS,
    },
  };

  if (isFlagged && !existing?.flaggedAt) set.flaggedAt = args.now;
  if (args.evaluation.tier === "healthy") {
    set.flaggedAt = null;
    set.clearedAt = args.now;
    set.lastAlertTier = "";
  }
  if (transition.shouldAlert) {
    set.lastAlertedAt = args.now;
    set.lastAlertTier = args.evaluation.tier;
  }

  await (NumberSpamStatus as any).updateOne(
    { userEmail, phoneNumber: args.evaluation.phoneNumber },
    { $set: set, $setOnInsert: { createdAt: args.now } },
    { upsert: true },
  );

  return {
    alerted: transition.shouldAlert,
    cleared: transition.shouldClearAlertState,
    previousTier: existing?.tier || null,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  if (!isAuthorizedCron(req)) return res.status(401).json({ message: "Unauthorized" });

  const now = new Date();
  const currentStart = new Date(now.getTime() - CURRENT_WINDOW_DAYS * DAY_MS);
  const priorStart = new Date(currentStart.getTime() - PRIOR_WINDOW_DAYS * DAY_MS);

  await mongooseConnect();

  const users = await (User as any)
    .find({ email: { $exists: true, $ne: "" } })
    .select("_id email agentPhone numbers")
    .lean();

  let tenantsChecked = 0;
  let numbersChecked = 0;
  let alertsAttempted = 0;
  let errors = 0;
  const details: any[] = [];

  for (const user of users) {
    const userEmail = String(user?.email || "").toLowerCase();
    const phoneNumbers = ((user?.numbers || []) as any[])
      .map((num) => normalizePhone(num?.phoneNumber))
      .filter(Boolean);
    if (!userEmail || !phoneNumbers.length) continue;

    tenantsChecked++;

    try {
      const [current, prior] = await Promise.all([
        buildWindowBuckets(userEmail, currentStart, now),
        buildWindowBuckets(userEmail, priorStart, currentStart),
      ]);
      const evaluations = evaluateNumbers({ phoneNumbers, current, prior });
      numbersChecked += evaluations.length;

      for (const evaluation of evaluations) {
        const result = await persistEvaluation({ user, evaluation, now });
        if (result.alerted) alertsAttempted++;
        details.push({
          userEmail,
          phoneNumber: evaluation.phoneNumber,
          tier: evaluation.tier,
          dials7d: evaluation.dials7d,
          answerRate: evaluation.answerRate,
          priorAnswerRate: evaluation.priorAnswerRate,
          shortCallRate: evaluation.shortCallRate,
          peerMedian: evaluation.peerMedian,
          alerted: result.alerted,
          previousTier: result.previousTier,
        });
      }
    } catch (err: any) {
      errors++;
      console.warn("[number-reputation] tenant failed", {
        userEmail,
        error: err?.message || String(err),
      });
    }
  }

  return res.status(200).json({
    ok: true,
    ranAt: now.toISOString(),
    aggregation:
      "Call grouped by tenant-scoped (ownerNumber || from) outbound windows; AICallRecording grouped by tenant-scoped fromNumber, skipping empty fromNumber; current 7d compared with prior 7d.",
    windows: {
      currentStart: currentStart.toISOString(),
      currentEnd: now.toISOString(),
      priorStart: priorStart.toISOString(),
      priorEnd: currentStart.toISOString(),
    },
    tenantsChecked,
    numbersChecked,
    alertsAttempted,
    errors,
    details,
  });
}
