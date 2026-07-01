// /lib/billing/trackAiDialerUsage.ts
import mongoose from "mongoose";
import User from "@/models/User";
import { createFinalizePayInvoice } from "@/lib/billing/trackUsage";

const isProd = process.env.NODE_ENV === "production";
const DEV_SKIP_BILLING = process.env.DEV_SKIP_BILLING === "1";

// $5/hour = $0.08333/minute
const AI_DIALER_RATE_PER_MIN_USD = Number(
  process.env.AI_DIALER_BILL_RATE_PER_MINUTE || "0.08333",
);

// AI Voice uses a separate $20 threshold — never shares the $10 regular bucket
const AI_DIALER_THRESHOLD_CENTS = 2000;

const BILLING_LOCK_TTL_MS = 10 * 60 * 1000; // 10 min ownership window

function isAdminEmail(email?: string | null) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

async function ensureDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

async function ensureMongooseDoc(user: any) {
  if (!user) return null;
  if (typeof user.save === "function") return user;

  if (user._id && mongoose.isValidObjectId(user._id)) {
    const doc = await User.findById(user._id);
    if (doc) return doc;
  }
  if (user.email) {
    const doc = await User.findOne({ email: user.email });
    if (doc) return doc;
  }
  return null;
}

/**
 * Track AI Voice usage and charge in $20 increments from the dedicated AI bucket.
 *
 * This does NOT route through trackUsage or the regular $10 bucket.
 * Accrual and threshold charging are fully atomic.
 */
export async function trackAiDialerUsage({
  user,
  minutes,
  vendorCostUsd,
}: {
  user: any;
  minutes: number;
  vendorCostUsd: number;
}) {
  await ensureDb();
  const userDoc = await ensureMongooseDoc(user);

  if (!userDoc) {
    if (isProd) {
      console.error("[AI Dialer billing] Missing user doc");
    } else {
      console.warn("[AI Dialer billing] Missing user doc, skipping");
    }
    return;
  }

  // Always track analytics regardless of billing eligibility
  await User.updateOne(
    { email: userDoc.email },
    {
      $inc: {
        "aiDialerUsage.vendorCost": vendorCostUsd,
        "aiDialerUsage.billedMinutes": minutes,
      },
    },
  );

  // Admin: analytics only, never billed
  if (isAdminEmail(userDoc.email)) return;

  // Legacy per-call billing is disabled; this function has no active callers.
  // Guard here so a future accidental re-wire can't produce charges.
  if (process.env.ENABLE_LEGACY_AI_DIALER_BILLING !== "1") return;

  // Must have AI upgrade to accrue AI dialer billing
  if (!userDoc.hasAI) {
    console.log(`[AI Dialer billing] Skipping — hasAI=false for ${userDoc.email}`);
    return;
  }

  const billableAmountUsd = minutes * AI_DIALER_RATE_PER_MIN_USD;
  const addCents =
    billableAmountUsd > 0 ? Math.max(0, Math.round(billableAmountUsd * 100)) : 0;

  if (addCents <= 0) return;

  if (!userDoc.stripeCustomerId) {
    if (isProd)
      console.error(`[AI Dialer billing] No stripeCustomerId for ${userDoc.email}`);
    return;
  }

  const canBill = !!userDoc.stripeCustomerId && !(DEV_SKIP_BILLING && isProd);

  // Atomic accrual into the AI-voice-only bucket
  const updated = await User.findOneAndUpdate(
    { email: userDoc.email },
    { $inc: { aiDialerAccruedCents: addCents } },
    { new: true, projection: { aiDialerAccruedCents: 1 } },
  );

  if (!updated) return;

  const newAccrued = Number((updated as any).aiDialerAccruedCents || 0);

  if (!canBill && !isProd && newAccrued >= AI_DIALER_THRESHOLD_CENTS) {
    console.warn(
      "[DEV billing] AI Dialer threshold reached but billing unavailable; accrual remains.",
    );
    return;
  }

  if (!canBill || newAccrued < AI_DIALER_THRESHOLD_CENTS) return;

  // ── Acquire exclusive AI billing lock ───────────────────────────────────────
  const lockOwner = new mongoose.Types.ObjectId().toString();
  const lockExpiresAt = new Date(Date.now() + BILLING_LOCK_TTL_MS);

  const locked = await User.findOneAndUpdate(
    {
      email: userDoc.email,
      aiDialerAccruedCents: { $gte: AI_DIALER_THRESHOLD_CENTS },
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
    { new: true, projection: { aiDialerAccruedCents: 1 } },
  );

  if (!locked) return; // another process holds the lock; accrual is safely stored

  const accrued = Number((locked as any).aiDialerAccruedCents || 0);
  const increments = Math.floor(accrued / AI_DIALER_THRESHOLD_CENTS);
  const billCents = increments * AI_DIALER_THRESHOLD_CENTS;

  if (billCents <= 0) {
    await User.updateOne(
      { email: userDoc.email, aiDialerBillingLockOwner: lockOwner },
      {
        $set: {
          aiDialerBillingLockAt: null,
          aiDialerBillingLockOwner: null,
          aiDialerBillingLockExpiresAt: null,
        },
      },
    );
    return;
  }

  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const idempotencyKey = `ailegacy_${userDoc.email}_${billCents}_${hourBucket}`;

  try {
    await createFinalizePayInvoice({
      customerId: userDoc.stripeCustomerId as string,
      amountCents: billCents,
      description: `Cove CRM AI Voice usage charge ($${(billCents / 100).toFixed(2)})`,
      idempotencyKey,
    });

    // Commit: only our lockOwner can execute this write
    await User.findOneAndUpdate(
      { email: userDoc.email, aiDialerBillingLockOwner: lockOwner },
      {
        $inc: {
          aiDialerAccruedCents: -billCents,
          aiDialerBilledTotalCents: billCents,
          "aiDialerUsage.billedAmount": billCents / 100,
        },
        $set: {
          aiDialerLastInvoicedAt: new Date(),
          "aiDialerUsage.lastChargedAt": new Date(),
          aiDialerBillingLockAt: null,
          aiDialerBillingLockOwner: null,
          aiDialerBillingLockExpiresAt: null,
        },
      },
    );
    console.log(
      `💳 AI Voice invoice: $${(billCents / 100).toFixed(2)} charged to ${userDoc.email}`,
    );
  } catch (err) {
    console.error("❌ Stripe AI Voice threshold charge failed:", err);
    // Release lock only — keep accrual so next event retries the charge
    await User.updateOne(
      { email: userDoc.email, aiDialerBillingLockOwner: lockOwner },
      {
        $set: {
          aiDialerBillingLockAt: null,
          aiDialerBillingLockOwner: null,
          aiDialerBillingLockExpiresAt: null,
        },
      },
    );
    // Do NOT throw — must not crash webhooks or block active calls
  }
}
