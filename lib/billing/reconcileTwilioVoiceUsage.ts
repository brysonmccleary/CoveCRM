import BillingMeterHealth from "@/models/BillingMeterHealth";
import Call from "@/models/Call";
import TwilioVoiceUsageCandidate from "@/models/TwilioVoiceUsageCandidate";
import User from "@/models/User";
import { initializeBillingMeter } from "@/lib/billing/billingMeterHealth";
import {
  MANUAL_TALK_RATE_PER_MIN,
  amountDollarsForBillableSeconds,
  billableConnectedSeconds,
} from "@/lib/billing/dialerRates";
import { trackUsage } from "@/lib/billing/trackUsage";
import { getPlatformTwilioClientScoped } from "@/lib/twilio/getPlatformClient";

const DISCOVERY_OVERLAP_MS = 60 * 1000;
const INITIAL_DEPLOYMENT_LOOKBACK_MS = 15 * 60 * 1000;
const DISCOVERY_LIMIT = 10_000;
const PENDING_LIMIT = 2_000;
const TERMINAL = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
const NEVER_BILL_EMAILS = new Set(["bryson.mccleary1@gmail.com", "support@covecrm.com"]);

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function asSeconds(value: unknown) {
  const seconds = Number(value || 0);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

function isPhoneEndpoint(value: unknown) {
  return /^\+\d{8,16}$/.test(String(value || "").trim());
}

export function isBillableTwilioVoiceChild(call: any) {
  return (
    String(call?.direction || "").toLowerCase() === "outbound-dial" &&
    Boolean(String(call?.parentCallSid || "").trim()) &&
    isPhoneEndpoint(call?.from) &&
    isPhoneEndpoint(call?.to)
  );
}

export async function ensureTwilioVoiceBillingIndexes() {
  await Promise.all([
    BillingMeterHealth.init(),
    TwilioVoiceUsageCandidate.init(),
  ]);
}

async function discoverCandidates(args: {
  accountSid: string;
  userEmail: string;
  start: Date;
  end: Date;
}) {
  if (args.end <= args.start) return 0;
  const client = getPlatformTwilioClientScoped(args.accountSid);
  const calls = await client.calls.list({
    startTimeAfter: args.start,
    startTimeBefore: args.end,
    limit: DISCOVERY_LIMIT,
  });
  if (calls.length >= DISCOVERY_LIMIT) {
    throw new Error("Twilio discovery limit reached; refusing to advance the billing cursor");
  }

  const now = new Date();
  const candidates = calls.filter(isBillableTwilioVoiceChild);
  for (let index = 0; index < candidates.length; index += 25) {
    await Promise.all(
      candidates.slice(index, index + 25).map((call: any) =>
        TwilioVoiceUsageCandidate.updateOne(
          { callSid: String(call.sid) },
          {
            $setOnInsert: {
              accountSid: args.accountSid,
              userEmail: args.userEmail,
              callSid: String(call.sid),
              parentCallSid: String(call.parentCallSid),
              direction: String(call.direction || ""),
              discoveredAt: now,
            },
            $set: {
              status: String(call.status || ""),
              durationSec: asSeconds(call.duration),
              startedAt: asDate(call.startTime || call.dateCreated),
              endedAt: asDate(call.endTime),
              lastCheckedAt: now,
            },
          },
          { upsert: true },
        ),
      ),
    );
  }
  return candidates.length;
}

async function refreshCandidate(client: any, candidate: any) {
  if (TERMINAL.has(String(candidate.status || "").toLowerCase())) return candidate;
  const call = await client.calls(String(candidate.callSid)).fetch();
  const next = {
    ...candidate,
    status: String(call.status || ""),
    durationSec: asSeconds(call.duration),
    startedAt: asDate(call.startTime || call.dateCreated),
    endedAt: asDate(call.endTime),
  };
  await TwilioVoiceUsageCandidate.updateOne(
    { _id: candidate._id, meteredAt: null, skippedAt: null },
    {
      $set: {
        status: next.status,
        durationSec: next.durationSec,
        startedAt: next.startedAt,
        endedAt: next.endedAt,
        lastCheckedAt: new Date(),
      },
    },
  );
  return next;
}

async function processCandidate(args: { client: any; candidate: any; user: any }) {
  const candidate = await refreshCandidate(args.client, args.candidate);
  const status = String(candidate.status || "").toLowerCase();
  if (!TERMINAL.has(status)) return "pending" as const;

  const durationSec = asSeconds(candidate.durationSec);
  if (status !== "completed" || durationSec <= 0) {
    await TwilioVoiceUsageCandidate.updateOne(
      { _id: candidate._id, meteredAt: null, skippedAt: null },
      {
        $set: {
          skippedAt: new Date(),
          skipReason: status !== "completed" ? `terminal_${status}` : "zero_duration",
        },
      },
    );
    return "skipped" as const;
  }

  const email = String(args.user.email || "").toLowerCase();
  const isExempt =
    String(args.user.billingMode || "").toLowerCase() === "self" ||
    String(args.user.role || "").toLowerCase() === "admin" ||
    NEVER_BILL_EMAILS.has(email);
  const billableSeconds = billableConnectedSeconds(durationSec);
  const amount = amountDollarsForBillableSeconds(
    billableSeconds,
    MANUAL_TALK_RATE_PER_MIN,
  );

  if (!isExempt) {
    await trackUsage({
      user: args.user,
      amount,
      source: "twilio-voice",
      eventKey: `twilio_voice:${String(candidate.callSid)}`,
      metadata: {
        callSid: String(candidate.callSid),
        accountSid: String(candidate.accountSid),
        parentCallSid: String(candidate.parentCallSid),
        billableSeconds,
        minutes: billableSeconds / 60,
        ratePerMinute: MANUAL_TALK_RATE_PER_MIN,
        recoveredBy: "twilio_first_reconciler",
      },
    });
  }

  const now = new Date();
  await Call.updateOne(
    { callSid: String(candidate.callSid) },
    {
      $setOnInsert: {
        callSid: String(candidate.callSid),
        userEmail: email,
        direction: "outbound",
        createdAt: candidate.startedAt || now,
      },
      $set: {
        status: "completed",
        billingCategory: "manual_dial",
        legType: "pstn",
        parentCallSid: String(candidate.parentCallSid),
        duration: durationSec,
        durationSec,
        billableSeconds,
        billedMinutes: billableSeconds / 60,
        billedAmount: isExempt ? 0 : amount,
        billingRatePerMinute: MANUAL_TALK_RATE_PER_MIN,
        billedAt: now,
        billedSource: "twilio_reconciliation",
        startedAt: candidate.startedAt || undefined,
        completedAt: candidate.endedAt || now,
        endedAt: candidate.endedAt || now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  await TwilioVoiceUsageCandidate.updateOne(
    { _id: candidate._id, meteredAt: null },
    {
      $set: {
        meteredAt: now,
        amountCents: isExempt ? 0 : Math.round(amount * 100),
        lastCheckedAt: now,
      },
    },
  );
  return "metered" as const;
}

export async function reconcileTwilioVoiceUsageForTenant(args: {
  userEmail: string;
  now?: Date;
}) {
  const now = args.now || new Date();
  const user = await User.findOne({ email: args.userEmail.toLowerCase() })
    .select("_id email role billingMode stripeCustomerId twilio.accountSid usageAccruedCents")
    .lean<any>();
  if (!user) throw new Error("Tenant user not found");
  const accountSid = String(user?.twilio?.accountSid || "").trim();
  if (!/^AC[a-zA-Z0-9]{32}$/.test(accountSid)) {
    throw new Error("Tenant has no valid Twilio subaccount SID");
  }

  let health = await initializeBillingMeter({
    accountSid,
    userEmail: user.email,
    now,
    // Covers the short interval between deployment and the first cron without
    // reopening historical billing. Existing callbacks are idempotent.
    cutoverAt: new Date(now.getTime() - INITIAL_DEPLOYMENT_LOOKBACK_MS),
  });
  await BillingMeterHealth.updateOne(
    { accountSid },
    { $set: { status: "pending", lastAttemptAt: now } },
  );

  try {
    health = await BillingMeterHealth.findOne({ accountSid });
    if (!health) throw new Error("Billing meter health state could not be initialized");
    const cutoverAt = new Date((health as any).cutoverAt);
    const cursorAt = new Date((health as any).discoveryCursorAt || cutoverAt);
    const discoveryStart = new Date(
      Math.max(cutoverAt.getTime(), cursorAt.getTime() - DISCOVERY_OVERLAP_MS),
    );

    const discovered = await discoverCandidates({
      accountSid,
      userEmail: user.email,
      start: discoveryStart,
      end: now,
    });

    const pending = await TwilioVoiceUsageCandidate.find({
      accountSid,
      meteredAt: null,
      skippedAt: null,
    })
      .sort({ startedAt: 1, createdAt: 1 })
      .limit(PENDING_LIMIT)
      .lean<any>();

    const client = getPlatformTwilioClientScoped(accountSid);
    let metered = 0;
    let skipped = 0;
    let stillPending = 0;
    for (let index = 0; index < pending.length; index += 10) {
      const outcomes = await Promise.all(
        pending.slice(index, index + 10).map((candidate: any) =>
          processCandidate({ client, candidate, user }),
        ),
      );
      metered += outcomes.filter((value) => value === "metered").length;
      skipped += outcomes.filter((value) => value === "skipped").length;
      stillPending += outcomes.filter((value) => value === "pending").length;
    }

    // Retry threshold settlement even when every discovered call was already
    // idempotently accrued by a webhook.
    await trackUsage({
      user,
      amount: 0,
      source: "twilio-voice",
      eventKey: "billing-threshold-retry",
    });
    const refreshed = await User.findOne({ email: user.email })
      .select("usageAccruedCents")
      .lean<any>();
    if (Number(refreshed?.usageAccruedCents || 0) >= 1000) {
      throw new Error("Usage threshold remains unsettled; outbound calling is paused");
    }
    if (pending.length >= PENDING_LIMIT) {
      throw new Error("Voice usage candidate backlog reached the processing limit");
    }

    await BillingMeterHealth.updateOne(
      { accountSid },
      {
        $set: {
          status: "healthy",
          discoveryCursorAt: now,
          lastSucceededAt: now,
          consecutiveFailures: 0,
        },
        $unset: { lastError: 1 },
      },
    );
    return { accountSid, discovered, metered, skipped, pending: stillPending };
  } catch (error: any) {
    await BillingMeterHealth.updateOne(
      { accountSid },
      {
        $set: {
          status: "unhealthy",
          lastAttemptAt: now,
          lastError: String(error?.message || error).slice(0, 500),
        },
        $inc: { consecutiveFailures: 1 },
      },
    );
    throw error;
  }
}
