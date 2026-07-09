// pages/api/ai-calls/watchdog.ts
//
// Safe watchdog for stuck AI dial sessions.
//
// DESIGN CONSTRAINTS (enforced here — do not relax):
//   - Never places calls directly.
//   - Only kicks status="running" sessions.
//   - Auto-stops running sessions with no activity for 2+ hours.
//   - Final-bills stopped/completed sessions exactly once.
//   - Never kicks a session with stoppedAt set.
//   - Never kicks a session with activeCallSidAt newer than 5 minutes.
//   - Never kicks the same session more than once within 8 minutes.
//   - Caps at 5 sessions per run to limit blast radius.
//   - Each kick is a targeted ?sessionId=X — the worker handles its own guards.

import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallSession from "@/models/AICallSession";
import AICallUsageLedger from "@/models/AICallUsageLedger";
import BillingEvent from "@/models/BillingEvent";
import User from "@/models/User";
import UsageAccrualLedger from "@/models/UsageAccrualLedger";
import { trackAiDialerSessionUsage } from "@/lib/billing/trackAiDialerSessionUsage";
import { stripe } from "@/lib/stripe";

const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();
const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

const BASE = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

// A session is considered stuck if a call was placed > STALE_PLACED_CALL_MS ago
// with no terminal callback. Normal calls complete in 2–8 min; 10 min is safe.
const STALE_PLACED_CALL_MS = 10 * 60 * 1000;
// Don't kick the same session again for 8 minutes.
const WATCHDOG_COOLDOWN_MS = 8 * 60 * 1000;
// Don't kick if an active call was recorded within the last 5 minutes.
const ACTIVE_CALL_GRACE_MS = 5 * 60 * 1000;
// Hard cap on sessions kicked per watchdog run.
const MAX_KICKS_PER_RUN = 5;
// Hard cap on sessions billed per watchdog run (billing is lightweight).
const MAX_BILLING_PER_RUN = 20;
// Any running session with no callback/call activity for 2h is closed before billing.
const STALE_RUNNING_SESSION_MS = 2 * 60 * 60 * 1000;
const STALE_CHARGING_BILLING_MS = 30 * 60 * 1000;
const MAX_STALE_CHARGING_RECOVERY_PER_RUN = 25;
const BUCKET_DRIFT_TOLERANCE_CENTS = 50;

function currentAiDialerCronKey() {
  return AI_DIALER_CRON_KEY || (process.env.AI_DIALER_CRON_KEY || "").trim();
}

function currentCronSecret() {
  return CRON_SECRET || (process.env.CRON_SECRET || "").trim();
}

function isAuthorized(req: NextApiRequest): boolean {
  const bearer = (String(req.headers["authorization"] || "").match(/^Bearer\s+(.+)$/i)?.[1] || "").trim();
  const hdr = (String(req.headers["x-cron-key"] || req.headers["x-cron-secret"] || "")).trim();
  const qs = (String((req.query.key as string) || (req.query.token as string) || "")).trim();
  const provided = bearer || hdr || qs;
  if (!provided) return false;
  const aiDialerCronKey = currentAiDialerCronKey();
  const cronSecret = currentCronSecret();
  return (!!aiDialerCronKey && provided === aiDialerCronKey) ||
         (!!cronSecret && provided === cronSecret);
}

async function kickSession(sessionId: string): Promise<boolean> {
  const secret = currentCronSecret() || currentAiDialerCronKey();
  if (!secret) return false;
  const url = `${BASE}/api/ai-calls/worker?sessionId=${encodeURIComponent(sessionId)}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "x-cron-key": secret,
        "x-cron-secret": secret,
      },
      signal: AbortSignal.timeout(5000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function logSharedStripeCustomers(): Promise<void> {
  try {
    const shared = await User.aggregate([
      {
        $match: {
          stripeCustomerId: { $exists: true, $nin: [null, ""] },
        },
      },
      {
        $group: {
          _id: "$stripeCustomerId",
          count: { $sum: 1 },
          users: { $push: { email: "$email", userId: "$_id" } },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 25 },
    ]).exec();

    for (const row of shared) {
      console.error("[BILLING][SHARED-CUSTOMER]", {
        stripeCustomerId: row._id,
        count: row.count,
        users: (row.users || []).map((user: any) => ({
          email: user.email,
          userId: String(user.userId || ""),
        })),
      });
    }
  } catch (err: any) {
    console.error("[BILLING][SHARED-CUSTOMER] check failed", { error: err?.message || String(err) });
  }
}

function billingStatusFromInvoice(invoice: any): "paid" | "stripe_created" | "pending" {
  const status = String(invoice?.status || "").toLowerCase();
  if (status === "paid") return "paid";
  if (status === "open" || status === "draft" || status === "uncollectible") return "stripe_created";
  return "pending";
}

async function recoverStaleChargingBillingEvents(now: number): Promise<number> {
  const cutoff = new Date(now - STALE_CHARGING_BILLING_MS);
  const staleEvents = await BillingEvent.find({
    status: "charging",
    updatedAt: { $lt: cutoff },
  })
    .select("_id idempotencyKey stripeInvoiceId")
    .limit(MAX_STALE_CHARGING_RECOVERY_PER_RUN)
    .lean();

  let recovered = 0;
  for (const event of staleEvents as any[]) {
    const invoiceId = String(event?.stripeInvoiceId || "").trim();
    const idempotencyKey = String(event?.idempotencyKey || "").trim();
    try {
      if (invoiceId) {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        await BillingEvent.updateOne(
          { _id: event._id, status: "charging" },
          {
            $set: {
              status: billingStatusFromInvoice(invoice),
              stripePaymentIntentId:
                typeof (invoice as any)?.payment_intent === "string"
                  ? (invoice as any).payment_intent
                  : ((invoice as any)?.payment_intent?.id || undefined),
              updatedAt: new Date(),
            },
          },
        );
      } else {
        await BillingEvent.updateOne(
          { _id: event._id, status: "charging" },
          {
            $set: {
              status: "pending",
              updatedAt: new Date(),
              blockedReason: idempotencyKey
                ? `stale_charging_reset_no_stripe_invoice:${idempotencyKey}`
                : "stale_charging_reset_no_stripe_invoice",
            },
          },
        );
      }
      recovered += 1;
    } catch (err: any) {
      console.warn("[AI WATCHDOG] stale BillingEvent recovery failed (non-blocking)", {
        billingEventId: String(event?._id || ""),
        idempotencyKey,
        invoiceId,
        error: err?.message || err,
      });
    }
  }
  return recovered;
}

async function recoverStaleChargingAiCallUsageLedgers(now: number): Promise<number> {
  const cutoff = new Date(now - STALE_CHARGING_BILLING_MS);
  const staleLedgers = await AICallUsageLedger.find({
    status: "charging",
    updatedAt: { $lt: cutoff },
  })
    .select("_id idempotencyKey stripeInvoiceId")
    .limit(MAX_STALE_CHARGING_RECOVERY_PER_RUN)
    .lean();

  let recovered = 0;
  for (const ledger of staleLedgers as any[]) {
    const invoiceId = String(ledger?.stripeInvoiceId || "").trim();
    const idempotencyKey = String(ledger?.idempotencyKey || "").trim();
    try {
      if (invoiceId) {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        await AICallUsageLedger.updateOne(
          { _id: ledger._id, status: "charging" },
          {
            $set: {
              status: billingStatusFromInvoice(invoice),
              paidAt: String((invoice as any)?.status || "").toLowerCase() === "paid" ? new Date() : null,
            },
          },
        );
      } else {
        await AICallUsageLedger.updateOne(
          { _id: ledger._id, status: "charging" },
          {
            $set: {
              status: "pending",
              skippedReason: idempotencyKey
                ? `stale_charging_reset_no_stripe_invoice:${idempotencyKey}`
                : "stale_charging_reset_no_stripe_invoice",
            },
          },
        );
      }
      recovered += 1;
    } catch (err: any) {
      console.warn("[AI WATCHDOG] stale AICallUsageLedger recovery failed (non-blocking)", {
        ledgerId: String(ledger?._id || ""),
        idempotencyKey,
        invoiceId,
        error: err?.message || err,
      });
    }
  }
  return recovered;
}

async function runBucketDriftCanary(): Promise<number> {
  const ledgerRows = await UsageAccrualLedger.aggregate([
    { $match: { status: "accrued" } },
    {
      $group: {
        _id: { userEmail: "$userEmail", bucket: "$bucket" },
        expected: {
          $sum: {
            $cond: [
              { $gt: [{ $subtract: ["$amountCents", "$billedCents"] }, 0] },
              { $subtract: ["$amountCents", "$billedCents"] },
              0,
            ],
          },
        },
      },
    },
  ]).exec();

  const expectedByKey = new Map<string, number>();
  for (const row of ledgerRows as any[]) {
    const userEmail = String(row?._id?.userEmail || "").toLowerCase();
    const bucket = String(row?._id?.bucket || "");
    if (!userEmail || !bucket) continue;
    expectedByKey.set(`${bucket}:${userEmail}`, Number(row.expected || 0));
  }

  const users = await User.find({
    $or: [
      { usageAccruedCents: { $gt: 0 } },
      { aiDialerAccruedSessionCents: { $gt: 0 } },
      { email: { $in: Array.from(expectedByKey.keys()).map((key) => key.split(":").slice(1).join(":")) } },
    ],
  })
    .select("email usageAccruedCents aiDialerAccruedSessionCents")
    .lean();

  let driftCount = 0;
  for (const user of users as any[]) {
    const email = String(user.email || "").toLowerCase();
    if (!email) continue;
    const checks = [
      { bucket: "regular", stored: Number(user.usageAccruedCents || 0) },
      { bucket: "ai_voice", stored: Number(user.aiDialerAccruedSessionCents || 0) },
    ];
    for (const check of checks) {
      const expected = expectedByKey.get(`${check.bucket}:${email}`) || 0;
      if (Math.abs(expected - check.stored) <= BUCKET_DRIFT_TOLERANCE_CENTS) continue;
      driftCount += 1;
      console.error("[BILLING][BUCKET-DRIFT]", {
        user: email,
        bucket: check.bucket,
        expected,
        stored: check.stored,
      });
      if (check.bucket === "regular") {
        await User.updateOne(
          { email },
          {
            $set: {
              usageBillingHold: true,
              usageBillingHoldReason: "bucket_drift",
              usageBillingHoldAt: new Date(),
              usageBillingHoldAccruedCents: check.stored,
            },
          },
        );
      } else {
        await User.updateOne(
          { email },
          {
            $set: {
              aiDialerBillingHold: true,
              aiDialerBillingHoldReason: "bucket_drift",
              aiDialerBillingHoldAt: new Date(),
              aiDialerBillingHoldAccruedCents: check.stored,
            },
          },
        );
      }
    }
  }
  return driftCount;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  if (!currentAiDialerCronKey() && !currentCronSecret()) {
    return res.status(500).json({ ok: false, message: "Cron auth not configured" });
  }

  if (!isAuthorized(req)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  await mongooseConnect();
  await logSharedStripeCustomers();

  const now = Date.now();
  const [recoveredBillingEvents, recoveredAiCallUsageLedgers] = await Promise.all([
    recoverStaleChargingBillingEvents(now),
    recoverStaleChargingAiCallUsageLedgers(now),
  ]);
  const bucketDrifts = await runBucketDriftCanary();
  const staleSessionCutoff = new Date(now - STALE_RUNNING_SESSION_MS);

  // ── Staleness closure ─────────────────────────────────────────────────────────
  // Prevents old running sessions from staying logically open for days/months.
  const staleRunningSessions = await AICallSession.find({
    status: "running",
    callDirection: { $ne: "inbound" },
    scriptKey: { $ne: "kayla_signup" },
    stoppedAt: null,
    startedAt: { $ne: null, $lt: staleSessionCutoff },
    $and: [
      {
        $or: [
          { lastCallbackAt: null },
          { lastCallbackAt: { $exists: false } },
          { lastCallbackAt: { $lt: staleSessionCutoff } },
        ],
      },
      {
        $or: [
          { lastPlacedCallAt: null },
          { lastPlacedCallAt: { $exists: false } },
          { lastPlacedCallAt: { $lt: staleSessionCutoff } },
        ],
      },
      {
        $or: [
          { activeCallSidAt: null },
          { activeCallSidAt: { $exists: false } },
          { activeCallSidAt: { $lt: staleSessionCutoff } },
        ],
      },
    ],
  })
    .select("_id userEmail startedAt lastCallbackAt lastPlacedCallAt activeCallSidAt")
    .limit(MAX_BILLING_PER_RUN)
    .lean();

  const autoStopped: string[] = [];
  for (const sess of staleRunningSessions) {
    const sessId = String((sess as any)._id);
    const sessEmail = String((sess as any).userEmail || "");
    if (!sessId || !sessEmail) continue;

    const stopAt = new Date();
    const stopped = await AICallSession.updateOne(
      { _id: (sess as any)._id, status: "running", stoppedAt: null },
      {
        $set: {
          status: "stopped",
          stoppedAt: stopAt,
          completedAt: stopAt,
          errorMessage: "AI session auto-stopped after 2 hours without call activity.",
          activeCallSid: null,
          activeCallSidAt: null,
          currentCall: null,
        },
      }
    ).exec();

    if (((stopped as any)?.modifiedCount ?? 0) === 0) continue;

    console.warn("[AI WATCHDOG] Auto-stopped stale running session", {
      sessionId: sessId,
      userEmail: sessEmail,
      startedAt: (sess as any).startedAt,
      lastCallbackAt: (sess as any).lastCallbackAt,
      lastPlacedCallAt: (sess as any).lastPlacedCallAt,
      activeCallSidAt: (sess as any).activeCallSidAt,
    });

    try {
      await trackAiDialerSessionUsage({ sessionId: sessId, userEmail: sessEmail, endAt: stopAt });
      await AICallSession.updateOne(
        { _id: (sess as any)._id, finalBilledAt: null },
        { $set: { finalBilledAt: new Date() } }
      ).exec();
    } catch (err: any) {
      console.warn("[AI WATCHDOG] auto-stop final billing failed (non-blocking)", {
        sessionId: sessId,
        error: err?.message || err,
      });
    }

    autoStopped.push(sessId);
  }

  // ── Session-time billing sweep ───────────────────────────────────────────────
  // Runs for ALL status="running" sessions every 2 minutes.
  // Each call bills only the newly elapsed seconds since the last checkpoint.
  // trackAiDialerSessionUsage uses an optimistic lock on billedSeconds so
  // concurrent watchdog invocations cannot double-bill the same window.
  const billingSessions = await AICallSession.find({
    status: "running",
    callDirection: { $ne: "inbound" },
    scriptKey: { $ne: "kayla_signup" },
    stoppedAt: null,
    startedAt: { $ne: null },
    finalBilledAt: null,
  })
    .select("_id userEmail")
    .limit(MAX_BILLING_PER_RUN)
    .lean();

  for (const sess of billingSessions) {
    const sessId = String((sess as any)._id);
    const sessEmail = String((sess as any).userEmail || "");
    if (!sessId || !sessEmail) continue;
    try {
      await trackAiDialerSessionUsage({ sessionId: sessId, userEmail: sessEmail });
    } catch (err: any) {
      console.warn("[AI WATCHDOG] session billing failed (non-blocking)", {
        sessionId: sessId,
        error: err?.message || err,
      });
    }
  }

  // Also run final billing for sessions that just completed/stopped (within last 15 min)
  // so the last partial interval is charged even though they're no longer "running".
  const recentlyEndedCutoff = new Date(now - 15 * 60 * 1000);
  const endedSessions = await AICallSession.find({
    status: { $in: ["completed", "stopped"] },
    callDirection: { $ne: "inbound" },
    scriptKey: { $ne: "kayla_signup" },
    startedAt: { $ne: null },
    finalBilledAt: null,
    updatedAt: { $gte: recentlyEndedCutoff },
  })
    .select("_id userEmail completedAt stoppedAt")
    .limit(10)
    .lean();

  for (const sess of endedSessions) {
    const sessId = String((sess as any)._id);
    const sessEmail = String((sess as any).userEmail || "");
    const endAt: Date = (sess as any).stoppedAt || (sess as any).completedAt || new Date();
    if (!sessId || !sessEmail) continue;
    try {
      await trackAiDialerSessionUsage({ sessionId: sessId, userEmail: sessEmail, endAt });
      await AICallSession.updateOne(
        { _id: (sess as any)._id, finalBilledAt: null },
        { $set: { finalBilledAt: new Date() } }
      ).exec();
    } catch (err: any) {
      console.warn("[AI WATCHDOG] final session billing failed (non-blocking)", {
        sessionId: sessId,
        error: err?.message || err,
      });
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const stalePlacedCutoff = new Date(now - STALE_PLACED_CALL_MS);
  const watchdogCooldownCutoff = new Date(now - WATCHDOG_COOLDOWN_MS);
  const activeCallCutoff = new Date(now - ACTIVE_CALL_GRACE_MS);

  // Find sessions that are genuinely stuck:
  //   - status exactly "running" (never queued/paused/stopped/completed/error)
  //   - stoppedAt null (not explicitly stopped by user)
  //   - lastPlacedCallAt exists and is stale (was actually dialing, now stuck)
  //   - no recent watchdog kick (prevents thrash)
  //   - no active call in the last 5 minutes (call isn't still ringing)
  const candidates = await AICallSession.find({
    status: "running",
    callDirection: { $ne: "inbound" },
    scriptKey: { $ne: "kayla_signup" },
    stoppedAt: null,
    // Must have placed a call and it must be stale (>10 min with no completion)
    lastPlacedCallAt: { $ne: null, $lt: stalePlacedCutoff },
    $and: [
      // Not kicked by watchdog recently
      {
        $or: [
          { lastWatchdogKickAt: null },
          { lastWatchdogKickAt: { $lt: watchdogCooldownCutoff } },
        ],
      },
      // No active call tracked in the last 5 minutes
      {
        $or: [
          { activeCallSidAt: null },
          { activeCallSidAt: { $lt: activeCallCutoff } },
        ],
      },
    ],
  })
    .sort({ lastPlacedCallAt: 1 }) // oldest stuck first
    .limit(MAX_KICKS_PER_RUN)
    .lean();

  if (!candidates.length) {
    return res.status(200).json({
      ok: true,
      message: "no_stuck_sessions",
      kicked: [],
      billedSessions: billingSessions.length,
      autoStopped,
      recoveredBillingEvents,
      recoveredAiCallUsageLedgers,
      bucketDrifts,
    });
  }

  const kicked: string[] = [];

  for (const session of candidates) {
    const sessionId = String((session as any)._id);

    // Atomically claim this session for this watchdog run before kicking.
    // Prevents two simultaneous watchdog invocations from double-kicking.
    const claimed = await AICallSession.updateOne(
      {
        _id: (session as any)._id,
        status: "running",
        stoppedAt: null,
        $or: [
          { lastWatchdogKickAt: null },
          { lastWatchdogKickAt: { $lt: watchdogCooldownCutoff } },
        ],
      },
      { $set: { lastWatchdogKickAt: new Date() } }
    ).exec();

    if (((claimed as any)?.modifiedCount ?? 0) === 0) {
      // Another watchdog instance claimed it first
      continue;
    }

    console.log("[AI WATCHDOG] Kicking stuck running session", {
      sessionId,
      lastPlacedCallAt: (session as any).lastPlacedCallAt,
      lastWatchdogKickAt: (session as any).lastWatchdogKickAt,
    });

    await kickSession(sessionId);
    kicked.push(sessionId);
  }

  return res.status(200).json({
    ok: true,
    kicked,
    total: kicked.length,
    billedSessions: billingSessions.length,
    autoStopped,
    recoveredBillingEvents,
    recoveredAiCallUsageLedgers,
    bucketDrifts,
  });
}
