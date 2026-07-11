// lib/billing/trackAiDialerSessionUsage.ts
//
// Bills AI dialer session wall-clock time at 1¢/min.
// Charges in $20 increments through the AI voice session bucket.
// Completely isolated from all other billing buckets (regular CRM usage, per-call-minute).
//
// Call sites:
//   - watchdog.ts every 2 min for all running sessions (periodic)
//   - session.ts PATCH stop action for the terminal proration (one-time at end)
import mongoose from "mongoose";
import User from "@/models/User";
import AICallSession from "@/models/AICallSession";
import { applyPaidBillingEvent, createFinalizePayInvoice } from "@/lib/billing/trackUsage";
import type { BillingEventSource } from "@/models/BillingEvent";
import { AI_SESSION_RATE_PER_MIN } from "@/lib/billing/dialerRates";
import {
  getPendingAccrualLedgerCents,
  recordUsageAccrualOnce,
} from "@/lib/billing/usageAccrualLedger";

const isProd = process.env.NODE_ENV === "production";
const DEV_SKIP_BILLING = process.env.DEV_SKIP_BILLING === "1";

// AI session time is 1¢/min. Charge every $20 of accrued session time.
const SESSION_RATE_CENTS_PER_MIN = Math.round(AI_SESSION_RATE_PER_MIN * 100);
const SESSION_THRESHOLD_CENTS = 2000;
const BILLING_LOCK_TTL_MS = 10 * 60 * 1000; // 10 min lock TTL
const MAX_SINGLE_CHECKPOINT_SECONDS = 6 * 60 * 60;
const STALE_BILLING_CHECKPOINT_MS = 24 * 60 * 60 * 1000;

type AiDialerSessionUsageResult = {
  billedSeconds: number;
  accrued: number;
  ok?: true;
  charged?: boolean;
  addCents?: number;
  newSeconds?: number;
  computedSeconds?: number;
  capped?: boolean;
};

type AiDialerCentsUsageResult = {
  ok: true;
  accrued: number;
  charged?: boolean;
  billCents?: number;
};

function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

async function ensureDb(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

/**
 * Bill elapsed session wall-clock time since the last billing checkpoint.
 *
 * Uses an optimistic lock on AICallSession.billedSeconds to prevent double-billing
 * from concurrent watchdog runs or a simultaneous watchdog + stop-action call.
 *
 * @param sessionId  AICallSession._id (string)
 * @param userEmail  Owner email
 * @param endAt      Defaults to now. Pass stoppedAt/completedAt for terminal billing.
 * @returns { billedSeconds, accrued } or null if nothing to bill / lock missed.
 */
export async function trackAiDialerSessionUsage({
  sessionId,
  userEmail,
  endAt = new Date(),
  allowThresholdCharge = true,
}: {
  sessionId: string;
  userEmail: string;
  endAt?: Date;
  allowThresholdCharge?: boolean;
}): Promise<AiDialerSessionUsageResult | null> {
  await ensureDb();

  if (!mongoose.isValidObjectId(sessionId)) {
    console.warn("[AI Session billing] Invalid sessionId", { sessionId });
    return null;
  }

  const sessionObjId = new mongoose.Types.ObjectId(sessionId);
  const email = userEmail.toLowerCase();

  // Read current session billing state
  const session = await AICallSession.findOne({ _id: sessionObjId, userEmail: email })
    .select("startedAt billedSeconds lastBilledAt status")
    .lean();

  if (!session || !session.startedAt) {
    return null;
  }

  const alreadyBilledSeconds = Number((session as any).billedSeconds ?? 0);
  const startedAt = new Date((session as any).startedAt);
  const lastBilledAt = (session as any).lastBilledAt
    ? new Date((session as any).lastBilledAt)
    : null;
  const totalElapsedSeconds = Math.floor(
    (endAt.getTime() - startedAt.getTime()) / 1000
  );
  const newSeconds = Math.max(0, totalElapsedSeconds - alreadyBilledSeconds);
  const windowStartedAt = new Date(startedAt.getTime() + alreadyBilledSeconds * 1000);
  const staleOverlappingWindow =
    !!lastBilledAt &&
    endAt.getTime() - lastBilledAt.getTime() > STALE_BILLING_CHECKPOINT_MS &&
    windowStartedAt.getTime() < lastBilledAt.getTime();
  const shouldCapCheckpoint =
    newSeconds > MAX_SINGLE_CHECKPOINT_SECONDS || staleOverlappingWindow;
  const billableSeconds = shouldCapCheckpoint
    ? staleOverlappingWindow
      ? 0
      : Math.min(newSeconds, MAX_SINGLE_CHECKPOINT_SECONDS)
    : newSeconds;
  const nextBilledSeconds = alreadyBilledSeconds + newSeconds;

  if (shouldCapCheckpoint) {
    console.warn("[BILLING][RUNAWAY-SESSION]", {
      sessionId,
      userEmail: email,
      computedSeconds: newSeconds,
      cappedSeconds: billableSeconds,
      startedAt,
      lastBilledAt,
    });
  }

  if (newSeconds <= 0) {
    await AICallSession.updateOne(
      { _id: sessionObjId, userEmail: email, billedSeconds: alreadyBilledSeconds },
      { $set: { lastBilledAt: new Date() } }
    );
    return { billedSeconds: 0, accrued: 0, ok: true, charged: false, newSeconds: 0 };
  }

  // Optimistic lock on billedSeconds: only the first concurrent caller succeeds.
  // Handles both old docs (field missing) and new docs (field = alreadyBilledSeconds).
  const sessionClaimed = await AICallSession.findOneAndUpdate(
    {
      _id: sessionObjId,
      userEmail: email,
      $or: [
        { billedSeconds: { $exists: false } },
        { billedSeconds: alreadyBilledSeconds },
      ],
    },
    {
      $set: {
        billedSeconds: nextBilledSeconds,
        lastBilledAt: new Date(),
        ...(shouldCapCheckpoint
          ? {
              runawayBillingCappedAt: new Date(),
              runawayBillingComputedSeconds: newSeconds,
              runawayBillingCappedSeconds: billableSeconds,
            }
          : {}),
      },
    },
    { new: false } // return pre-update doc; null means another process won
  );

  if (!sessionClaimed) {
    // Another concurrent billing call already claimed this window
    return null;
  }

  const billableMinutes = billableSeconds > 0 ? Math.ceil(billableSeconds / 60) : 0;
  const addCents = billableMinutes * SESSION_RATE_CENTS_PER_MIN;

  if (addCents <= 0) {
    await AICallSession.updateOne(
      { _id: sessionObjId, userEmail: email, billedSeconds: nextBilledSeconds },
      { $set: { lastBilledAt: new Date() } }
    );
    await User.updateOne({ email }, { $inc: { aiDialerSessionSeconds: billableSeconds } });
    return {
      billedSeconds: billableSeconds,
      accrued: 0,
      ok: true,
      charged: false,
      addCents: 0,
      newSeconds: billableSeconds,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
    };
  }

  // Admin: track analytics only, never charge
  if (isAdminEmail(email)) {
    await User.updateOne({ email }, { $inc: { aiDialerSessionSeconds: billableSeconds } });
    return {
      billedSeconds: billableSeconds,
      accrued: 0,
      newSeconds: billableSeconds,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
    };
  }

  // Fetch user for eligibility + Stripe ID
  const userDoc = await User.findOne({ email })
    .select(
      [
        "hasAI",
        "stripeCustomerId",
        "aiDialerAccruedSessionCents",
        "aiDialerSessionDailyWindowStartedAt",
        "aiDialerSessionDailyAccruedCents",
        "aiDialerBillingHold",
        "aiDialerBillingHoldReason",
        "aiDialerBillingHoldClearedAt",
        "hasEverPaid",
        "billingBlocked",
        "billingMode",
      ].join(" ")
    )
    .lean();

  if (
    !userDoc ||
    !(userDoc as any).hasAI ||
    !(userDoc as any).hasEverPaid ||
    (userDoc as any).billingBlocked === true
  ) {
    // Still track seconds for analytics
    await User.updateOne({ email }, { $inc: { aiDialerSessionSeconds: billableSeconds } });
    return {
      billedSeconds: billableSeconds,
      accrued: 0,
      newSeconds: billableSeconds,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
    };
  }

  const eventKey = `ai_voice:session:${sessionId}:${alreadyBilledSeconds}:${nextBilledSeconds}`;
  const accrualEvent = await recordUsageAccrualOnce({
    bucket: "ai_voice",
    userEmail: email,
    eventKey,
    source: "ai_voice_session",
    amountCents: addCents,
    origin: "dialer",
    metadata: {
      sessionId,
      alreadyBilledSeconds,
      nextBilledSeconds,
      billableSeconds,
      billableMinutes,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
    },
  });
  if (!accrualEvent.accrued) {
    await User.updateOne({ email }, { $inc: { aiDialerSessionSeconds: billableSeconds } });
    return {
      billedSeconds: billableSeconds,
      accrued: 0,
      newSeconds: billableSeconds,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
      charged: false,
    };
  }

  // Atomically increment lifetime seconds + session accrual bucket
  const updated = await User.findOneAndUpdate(
    { email },
    {
      $inc: {
        aiDialerSessionSeconds: billableSeconds,
        aiDialerAccruedSessionCents: addCents,
      },
    },
    {
      new: true,
      projection: {
        aiDialerAccruedSessionCents: 1,
        stripeCustomerId: 1,
      },
    }
  );

  if (!updated) {
    return {
      billedSeconds: billableSeconds,
      accrued: addCents,
      newSeconds: billableSeconds,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
    };
  }

  const newAccrued = Number((updated as any).aiDialerAccruedSessionCents || 0);
  const holdReason = shouldCapCheckpoint ? "runaway_session" : "";

  if (holdReason) {
    await User.updateOne(
      { email },
      {
        $set: {
          aiDialerBillingHold: true,
          aiDialerBillingHoldReason: holdReason,
          aiDialerBillingHoldAt: new Date(),
          aiDialerBillingHoldAccruedCents: newAccrued,
        },
      }
    );
    console.error("[BILLING][CHARGE-HOLD]", {
      userEmail: email,
      reason: holdReason,
      accruedCents: newAccrued,
    });
    return {
      billedSeconds: billableSeconds,
      accrued: addCents,
      newSeconds: billableSeconds,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
      charged: false,
    };
  }

  const canBill = !!(userDoc as any).stripeCustomerId && !(DEV_SKIP_BILLING && isProd);

  if (!canBill && !isProd && newAccrued >= SESSION_THRESHOLD_CENTS) {
    console.warn("[DEV billing] AI session threshold reached but billing unavailable; accrual remains.");
    return {
      billedSeconds: billableSeconds,
      accrued: addCents,
      newSeconds: billableSeconds,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
    };
  }

  if (!allowThresholdCharge || !canBill || newAccrued < SESSION_THRESHOLD_CENTS) {
    return {
      billedSeconds: billableSeconds,
      accrued: addCents,
      newSeconds: billableSeconds,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
    };
  }

  // ── Acquire exclusive billing lock ──────────────────────────────────────────
  const lockOwner = new mongoose.Types.ObjectId().toString();
  const lockExpiresAt = new Date(Date.now() + BILLING_LOCK_TTL_MS);

  const locked = await User.findOneAndUpdate(
    {
      email,
      aiDialerAccruedSessionCents: { $gte: SESSION_THRESHOLD_CENTS },
      $or: [
        { aiDialerBillingLockAt: null },
        { aiDialerBillingLockExpiresAt: { $lt: new Date() } },
      ],
    },
    {
      $set: {
        aiDialerBillingLockAt: new Date(),
        aiDialerBillingLockOwner: lockOwner,
        aiDialerBillingLockExpiresAt: lockExpiresAt,
      },
    },
    { new: true, projection: { aiDialerAccruedSessionCents: 1, aiDialerBilledTotalCents: 1 } }
  );

  if (!locked) {
    return {
      billedSeconds: billableSeconds,
      accrued: addCents,
      newSeconds: billableSeconds,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
    };
  }

  const accrued = Number((locked as any).aiDialerAccruedSessionCents || 0);
  const ledgerPendingCents = await getPendingAccrualLedgerCents({
    bucket: "ai_voice",
    userEmail: email,
  });
  if (accrued > ledgerPendingCents) {
    console.error("[BILLING][PRE-LEDGER-BALANCE-DRIFT]", {
      userEmail: email,
      bucket: "ai_voice",
      storedCents: accrued,
      ledgerBackedCents: ledgerPendingCents,
      unledgeredCents: accrued - ledgerPendingCents,
    });
  }
  // Bill exactly one ledger-backed threshold increment per event ($20 max).
  // Stored pre-ledger balance is never included unless backed by ledger rows.
  const billCents = ledgerPendingCents >= SESSION_THRESHOLD_CENTS ? SESSION_THRESHOLD_CENTS : 0;

  if (billCents <= 0) {
    await User.updateOne(
      { email, aiDialerBillingLockOwner: lockOwner },
      {
        $set: {
          aiDialerBillingLockAt: null,
          aiDialerBillingLockOwner: null,
          aiDialerBillingLockExpiresAt: null,
        },
      }
    );
    return {
      billedSeconds: billableSeconds,
      accrued: addCents,
      newSeconds: billableSeconds,
      computedSeconds: newSeconds,
      capped: shouldCapCheckpoint,
    };
  }

  const currentAiBilledTotal = Number((locked as any).aiDialerBilledTotalCents || 0);
  const thresholdSequence = Math.floor(currentAiBilledTotal / SESSION_THRESHOLD_CENTS) + 1;

  try {
    const event = await createFinalizePayInvoice({
      customerId: (userDoc as any).stripeCustomerId as string,
      amountCents: billCents,
      description: `Cove CRM AI Voice session usage ($${(billCents / 100).toFixed(2)})`,
      source: "ai_voice_session",
      sourceId: `ai_voice_session:${String((userDoc as any)._id)}:${thresholdSequence}`,
      userEmail: email,
      userId: String((userDoc as any)._id),
      bucket: "ai_voice",
      metadata: { userEmail: email, sessionId },
    });
    await applyPaidBillingEvent(event);
    await User.updateOne(
      { email, aiDialerBillingLockOwner: lockOwner },
      { $set: { aiDialerBillingLockAt: null, aiDialerBillingLockOwner: null, aiDialerBillingLockExpiresAt: null } },
    );
    console.log(`💳 AI Voice session invoice: $${(billCents / 100).toFixed(2)} charged to ${email}`);
  } catch (err) {
    console.error("❌ AI Voice threshold settlement or application failed:", err);
    // Release lock, keep accrual so next billing event retries
    await User.updateOne(
      { email, aiDialerBillingLockOwner: lockOwner },
      {
        $set: {
          aiDialerBillingLockAt: null,
          aiDialerBillingLockOwner: null,
          aiDialerBillingLockExpiresAt: null,
        },
      }
    );
    // Do NOT throw — must not crash callers
  }

  return {
    billedSeconds: billableSeconds,
    accrued: addCents,
    newSeconds: billableSeconds,
    computedSeconds: newSeconds,
    capped: shouldCapCheckpoint,
  };
}

export async function trackAiDialerCentsUsage({
  userEmail,
  addCents,
  description,
  source,
  eventKey,
  metadata,
  allowThresholdCharge = true,
}: {
  userEmail: string;
  addCents: number;
  description: string;
  source: BillingEventSource;
  eventKey: string;
  metadata?: Record<string, unknown>;
  allowThresholdCharge?: boolean;
}): Promise<AiDialerCentsUsageResult | null> {
  await ensureDb();

  const email = userEmail.toLowerCase();
  const cents = Math.max(0, Math.round(addCents));
  if (cents <= 0) {
    return { ok: true, accrued: 0, charged: false };
  }

  if (isAdminEmail(email)) {
    return { ok: true, accrued: 0, charged: false };
  }

  const userDoc = await User.findOne({ email })
    .select(
      [
        "hasAI",
        "stripeCustomerId",
        "aiDialerAccruedSessionCents",
        "aiDialerSessionDailyWindowStartedAt",
        "aiDialerSessionDailyAccruedCents",
        "aiDialerBillingHold",
        "aiDialerBillingHoldReason",
        "aiDialerBillingHoldClearedAt",
        "hasEverPaid",
        "billingBlocked",
        "billingMode",
      ].join(" "),
    )
    .lean();

  if (
    !userDoc ||
    !(userDoc as any).hasAI ||
    !(userDoc as any).hasEverPaid ||
    (userDoc as any).billingBlocked === true
  ) {
    return { ok: true, accrued: 0, charged: false };
  }

  const accrualEvent = await recordUsageAccrualOnce({
    bucket: "ai_voice",
    userEmail: email,
    eventKey: `ai_voice:${eventKey}`,
    source,
    amountCents: cents,
    origin: "dialer",
    metadata: {
      ...(metadata || {}),
      description,
      source,
    },
  });
  if (!accrualEvent.accrued) {
    return { ok: true, accrued: 0, charged: false };
  }

  const updated = await User.findOneAndUpdate(
    { email },
    {
      $inc: {
        aiDialerAccruedSessionCents: cents,
        "aiDialerUsage.billedAmount": cents / 100,
      },
    },
    {
      new: true,
      projection: {
        aiDialerAccruedSessionCents: 1,
        stripeCustomerId: 1,
      },
    }
  );

  if (!updated) return { ok: true, accrued: cents, charged: false };

  const newAccrued = Number((updated as any).aiDialerAccruedSessionCents || 0);
  const canBill = !!(userDoc as any).stripeCustomerId && !(DEV_SKIP_BILLING && isProd);

  if (!canBill && !isProd && newAccrued >= SESSION_THRESHOLD_CENTS) {
    console.warn("[DEV billing] AI dialer threshold reached but billing unavailable; accrual remains.");
    return { ok: true, accrued: cents, charged: false };
  }

  if (!allowThresholdCharge || !canBill || newAccrued < SESSION_THRESHOLD_CENTS) {
    return { ok: true, accrued: cents, charged: false };
  }

  const lockOwner = new mongoose.Types.ObjectId().toString();
  const lockExpiresAt = new Date(Date.now() + BILLING_LOCK_TTL_MS);

  const locked = await User.findOneAndUpdate(
    {
      email,
      aiDialerAccruedSessionCents: { $gte: SESSION_THRESHOLD_CENTS },
      $or: [
        { aiDialerBillingLockAt: null },
        { aiDialerBillingLockExpiresAt: { $lt: new Date() } },
      ],
    },
    {
      $set: {
        aiDialerBillingLockAt: new Date(),
        aiDialerBillingLockOwner: lockOwner,
        aiDialerBillingLockExpiresAt: lockExpiresAt,
      },
    },
    { new: true, projection: { aiDialerAccruedSessionCents: 1, aiDialerBilledTotalCents: 1 } }
  );

  if (!locked) return { ok: true, accrued: cents, charged: false };

  const accrued = Number((locked as any).aiDialerAccruedSessionCents || 0);
  const ledgerPendingCents = await getPendingAccrualLedgerCents({
    bucket: "ai_voice",
    userEmail: email,
  });
  if (accrued > ledgerPendingCents) {
    console.error("[BILLING][PRE-LEDGER-BALANCE-DRIFT]", {
      userEmail: email,
      bucket: "ai_voice",
      storedCents: accrued,
      ledgerBackedCents: ledgerPendingCents,
      unledgeredCents: accrued - ledgerPendingCents,
    });
  }
  // Bill exactly one ledger-backed threshold increment per event ($20 max).
  const billCents = ledgerPendingCents >= SESSION_THRESHOLD_CENTS ? SESSION_THRESHOLD_CENTS : 0;

  if (billCents <= 0) {
    await User.updateOne(
      { email, aiDialerBillingLockOwner: lockOwner },
      {
        $set: {
          aiDialerBillingLockAt: null,
          aiDialerBillingLockOwner: null,
          aiDialerBillingLockExpiresAt: null,
        },
      }
    );
    return { ok: true, accrued: cents, charged: false };
  }

  const currentAiBilledTotal = Number((locked as any).aiDialerBilledTotalCents || 0);
  const thresholdSequence = Math.floor(currentAiBilledTotal / SESSION_THRESHOLD_CENTS) + 1;
  const sourceId = `ai_voice_session:${String((userDoc as any)._id)}:${thresholdSequence}`;

  try {
    const event = await createFinalizePayInvoice({
      customerId: (userDoc as any).stripeCustomerId as string,
      amountCents: billCents,
      description,
      source,
      sourceId,
      userEmail: email,
      userId: String((userDoc as any)._id),
      bucket: "ai_voice",
      metadata: { userEmail: email },
    });
    await applyPaidBillingEvent(event);
    await User.updateOne(
      { email, aiDialerBillingLockOwner: lockOwner },
      { $set: { aiDialerBillingLockAt: null, aiDialerBillingLockOwner: null, aiDialerBillingLockExpiresAt: null } },
    );

    return { ok: true, accrued: cents, charged: true, billCents };
  } catch (err) {
    console.error("❌ AI dialer threshold settlement or application failed:", err);
    await User.updateOne(
      { email, aiDialerBillingLockOwner: lockOwner },
      {
        $set: {
          aiDialerBillingLockAt: null,
          aiDialerBillingLockOwner: null,
          aiDialerBillingLockExpiresAt: null,
        },
      }
    );
    return { ok: true, accrued: cents, charged: false };
  }
}
