// /lib/billing/trackAiDialerUsage.ts
import mongoose from "mongoose";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

const isProd = process.env.NODE_ENV === "production";
const DEV_SKIP_BILLING = process.env.DEV_SKIP_BILLING === "1";

/**
 * 🔹 What you charge the user for AI dialer:
 * Default: $0.15/min → $9/hour if talk time is ~36 minutes/hour,
 * but practically you’re thinking of it as 15¢ per connected minute.
 */
const AI_DIALER_RATE_PER_MIN_USD = Number(
  process.env.AI_DIALER_RATE_PER_MIN_USD ?? "0.15"
);

/**
 * 🔹 Top-up chunk size for AI dialer:
 * Default: $20 → ~133 minutes at $0.15/min.
 */
const AI_DIALER_TOPUP_USD = Number(process.env.AI_DIALER_TOPUP_USD ?? "20");
const AI_DIALER_TOPUP_CENTS = AI_DIALER_TOPUP_USD * 100;

/** ========= Admin allow-list (same pattern as other billing) ========= */
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

async function createAndChargeInvoice(params: {
  customerId: string;
  amountCents: number;
  description: string;
}) {
  const { customerId, amountCents, description } = params;

  await stripe.invoiceItems.create({
    customer: customerId,
    amount: amountCents,
    currency: "usd",
    description,
  });

  await stripe.invoices.create({
    customer: customerId,
    collection_method: "charge_automatically",
    auto_advance: true,
  });
}

export async function trackAiDialerUsage({
  user,
  minutes,
  vendorCostUsd,
}: {
  user: any;
  minutes: number; // total connected minutes for this call
  vendorCostUsd: number; // your raw cost (Twilio + OpenAI) for those minutes
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

  // Always track analytics (raw vendor cost + billed minutes).
  const prevUsage = userDoc.aiDialerUsage || {
    vendorCost: 0,
    billedMinutes: 0,
    billedAmount: 0,
    lastChargedAt: null,
  };

  const billableAmountUsd = minutes * AI_DIALER_RATE_PER_MIN_USD;

  userDoc.aiDialerUsage = {
    vendorCost: prevUsage.vendorCost + vendorCostUsd,
    billedMinutes: prevUsage.billedMinutes + minutes,
    billedAmount: prevUsage.billedAmount + billableAmountUsd,
    lastChargedAt: new Date(),
  };

  // Admins never actually billed for AI dialer, but we keep stats
  if (isAdminEmail(userDoc.email)) {
    // Admins should also be considered "armed" (harmless, keeps logic consistent)
    if (typeof (userDoc as any).aiDialerAutoReloadArmed !== "boolean") {
      (userDoc as any).aiDialerAutoReloadArmed = true;
    }
    await userDoc.save();
    return;
  }

  // Initialize balance if null/undefined
  if (typeof userDoc.aiDialerBalance !== "number") {
    userDoc.aiDialerBalance = 0;
  }

  /**
   * ✅ IMPORTANT: Do NOT allow $20 auto-topup until the user has actually used AI Dialer.
   * We "arm" auto-topup the first time we ever record dialer usage for this user.
   *
   * This prevents SMS-only AI buyers from ever being charged $20.
   */
  if (minutes > 0 && typeof (userDoc as any).aiDialerAutoReloadArmed !== "boolean") {
    (userDoc as any).aiDialerAutoReloadArmed = true;
  } else if (minutes > 0 && (userDoc as any).aiDialerAutoReloadArmed === false) {
    (userDoc as any).aiDialerAutoReloadArmed = true;
  }

  // Subtract this call's billed amount from AI dialer balance
  userDoc.aiDialerBalance = (userDoc.aiDialerBalance || 0) - billableAmountUsd;

  const canBill =
    !!userDoc.stripeCustomerId &&
    !(DEV_SKIP_BILLING && isProd);

  // If no Stripe customer, we just track usage but do not auto-topup here
  if (!userDoc.stripeCustomerId) {
    if (isProd) {
      console.warn(
        "[AI Dialer billing] User missing Stripe customer; balance may go negative.",
        { email: userDoc.email }
      );
    } else {
      console.warn(
        "[AI Dialer billing][DEV] No Stripe customer; skipping auto-topup.",
        { email: userDoc.email }
      );
    }
  }

  // ✅ Gate auto-topup: only after AI Dialer has actually been used at least once
  const autoReloadArmed = (userDoc as any).aiDialerAutoReloadArmed === true;

  // Auto-topup when AI dialer balance drops below $1
  if (userDoc.aiDialerBalance < 1 && canBill && autoReloadArmed) {
    try {
      await createAndChargeInvoice({
        customerId: userDoc.stripeCustomerId!,
        amountCents: AI_DIALER_TOPUP_CENTS,
        description: `CoveCRM AI Dialer credit ($${AI_DIALER_TOPUP_USD})`,
      });

      userDoc.aiDialerBalance += AI_DIALER_TOPUP_USD;
      console.log(
        `💰 AI Dialer auto-topup: $${AI_DIALER_TOPUP_USD} charged to ${userDoc.email}`
      );
    } catch (err) {
      console.error(
        "❌ AI Dialer Stripe auto top-up failed:",
        (err as any)?.message || err
      );
    }
  } else if (userDoc.aiDialerBalance < 1 && canBill && !autoReloadArmed) {
    // This is the "no charge until they use dialer" guarantee.
    // They only get here if they somehow have a low balance *before* first use.
    // We intentionally do NOT charge.
    if (!isProd) {
      console.warn(
        "[AI Dialer billing][DEV] Balance < $1 but auto-reload not armed yet; not charging.",
        { email: userDoc.email }
      );
    }
  } else if (userDoc.aiDialerBalance < 1 && !canBill && !isProd) {
    console.warn(
      "[AI Dialer billing][DEV] Balance < $1 but billing disabled/unavailable; continuing for testing.",
      { email: userDoc.email }
    );
  }

  await userDoc.save();
}
