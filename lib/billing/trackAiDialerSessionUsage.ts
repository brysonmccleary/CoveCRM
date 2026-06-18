// lib/billing/trackAiDialerSessionUsage.ts
//
// Bills AI dialer session wall-clock time at $5/hr ($500 cents/hr).
// Charges in $20 increments (every 4 hours of session time).
// Completely isolated from all other billing buckets (regular CRM usage, per-call-minute).
//
// Call sites:
//   - watchdog.ts every 2 min for all running sessions (periodic)
//   - session.ts PATCH stop action for the terminal proration (one-time at end)
import mongoose from "mongoose";
import User from "@/models/User";
import AICallSession from "@/models/AICallSession";
import { createFinalizePayInvoice } from "@/lib/billing/trackUsage";

const isProd = process.env.NODE_ENV === "production";
const DEV_SKIP_BILLING = process.env.DEV_SKIP_BILLING === "1";

// $5/hr = 500 cents/hr. Charge every $20 = every 4 hours.
const SESSION_RATE_CENTS_PER_HOUR = 500;
const SESSION_THRESHOLD_CENTS = 2000;
const BILLING_LOCK_TTL_MS = 10 * 60 * 1000; // 10 min lock TTL

type AiDialerSessionUsageResult = {
  billedSeconds: number;
  accrued: number;
  ok?: true;
  charged?: boolean;
  addCents?: number;
  newSeconds?: number;
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
}: {
  sessionId: string;
  userEmail: string;
  endAt?: Date;
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
    .select("startedAt billedSeconds status")
    .lean();

  if (!session || !session.startedAt) {
    return null;
  }

  const alreadyBilledSeconds = Number((session as any).billedSeconds ?? 0);
  const totalElapsedSeconds = Math.floor(
    (endAt.getTime() - new Date(session.startedAt).getTime()) / 1000
  );
  const newSeconds = Math.max(0, totalElapsedSeconds - alreadyBilledSeconds);

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
      $inc: { billedSeconds: newSeconds },
      $set: { lastBilledAt: new Date() },
    },
    { new: false } // return pre-update doc; null means another process won
  );

  if (!sessionClaimed) {
    // Another concurrent billing call already claimed this window
    return null;
  }

  const addCents = Math.round((newSeconds / 3600) * SESSION_RATE_CENTS_PER_HOUR);

  if (addCents <= 0) {
    await AICallSession.updateOne(
      { _id: sessionObjId, userEmail: email, billedSeconds: alreadyBilledSeconds + newSeconds },
      { $set: { lastBilledAt: new Date() } }
    );
    await User.updateOne({ email }, { $inc: { aiDialerSessionSeconds: newSeconds } });
    return { billedSeconds: newSeconds, accrued: 0, ok: true, charged: false, addCents: 0 };
  }

  // Admin: track analytics only, never charge
  if (isAdminEmail(email)) {
    await User.updateOne({ email }, { $inc: { aiDialerSessionSeconds: newSeconds } });
    return { billedSeconds: newSeconds, accrued: 0 };
  }

  // Fetch user for eligibility + Stripe ID
  const userDoc = await User.findOne({ email })
    .select("hasAI stripeCustomerId aiDialerAccruedSessionCents")
    .lean();

  if (!userDoc || !(userDoc as any).hasAI) {
    // Still track seconds for analytics
    await User.updateOne({ email }, { $inc: { aiDialerSessionSeconds: newSeconds } });
    return { billedSeconds: newSeconds, accrued: 0 };
  }

  // Atomically increment lifetime seconds + session accrual bucket
  const updated = await User.findOneAndUpdate(
    { email },
    {
      $inc: {
        aiDialerSessionSeconds: newSeconds,
        aiDialerAccruedSessionCents: addCents,
      },
    },
    { new: true, projection: { aiDialerAccruedSessionCents: 1, stripeCustomerId: 1 } }
  );

  if (!updated) return { billedSeconds: newSeconds, accrued: addCents };

  const newAccrued = Number((updated as any).aiDialerAccruedSessionCents || 0);
  const canBill = !!(userDoc as any).stripeCustomerId && !(DEV_SKIP_BILLING && isProd);

  if (!canBill && !isProd && newAccrued >= SESSION_THRESHOLD_CENTS) {
    console.warn("[DEV billing] AI session threshold reached but billing unavailable; accrual remains.");
    return { billedSeconds: newSeconds, accrued: addCents };
  }

  if (!canBill || newAccrued < SESSION_THRESHOLD_CENTS) {
    return { billedSeconds: newSeconds, accrued: addCents };
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
    { new: true, projection: { aiDialerAccruedSessionCents: 1 } }
  );

  if (!locked) return { billedSeconds: newSeconds, accrued: addCents };

  const accrued = Number((locked as any).aiDialerAccruedSessionCents || 0);
  const increments = Math.floor(accrued / SESSION_THRESHOLD_CENTS);
  const billCents = increments * SESSION_THRESHOLD_CENTS;

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
    return { billedSeconds: newSeconds, accrued: addCents };
  }

  const idempotencyKey = `aisess_${email}_${lockOwner}`;

  try {
    await createFinalizePayInvoice({
      customerId: (userDoc as any).stripeCustomerId as string,
      amountCents: billCents,
      description: `Cove CRM AI Voice session usage ($${(billCents / 100).toFixed(2)})`,
      idempotencyKey,
    });

    await User.findOneAndUpdate(
      { email, aiDialerBillingLockOwner: lockOwner },
      {
        $inc: {
          aiDialerAccruedSessionCents: -billCents,
          aiDialerBilledTotalCents: billCents,
        },
        $set: {
          aiDialerLastChargedAt: new Date(),
          aiDialerBillingLockAt: null,
          aiDialerBillingLockOwner: null,
          aiDialerBillingLockExpiresAt: null,
        },
      }
    );
    console.log(`💳 AI Voice session invoice: $${(billCents / 100).toFixed(2)} charged to ${email}`);
  } catch (err) {
    console.error("❌ Stripe AI Voice session charge failed:", err);
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

  return { billedSeconds: newSeconds, accrued: addCents };
}
