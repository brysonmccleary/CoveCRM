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

  // Note: billedAmount is kept as ACTUAL charged total (updated when invoices are created).
  const billedTotalUsd = Number((userDoc as any).aiDialerBilledTotalCents || 0) / 100;
  userDoc.aiDialerUsage = {
    vendorCost: prevUsage.vendorCost + vendorCostUsd,
    billedMinutes: prevUsage.billedMinutes + minutes,
    billedAmount: billedTotalUsd,
    lastChargedAt: prevUsage.lastChargedAt || null,
  };


  /**
   * ✅ POSTPAID AI DIALER BILLING (LOCKED):
   * - Do NOT use "aiDialerBalance" top-ups.
   * - Accrue billed usage in cents.
   * - Charge Stripe in $20 increments when accrued reaches threshold.
   * - Admin allow-list is unchanged (admins never billed).
   */

  // Admins never billed for AI dialer, but we keep stats
  if (isAdminEmail(userDoc.email)) {
    await userDoc.save();
    return;
  }

  // ✅ Must have AI upgrade to accrue/charge AI dialer usage
  // (We still track vendorCost + minutes analytics above)
  if (!userDoc.hasAI) {
    await userDoc.save();
    return;
  }

  // Initialize accrual fields if missing
  if (typeof (userDoc as any).aiDialerAccruedCents !== "number") {
    (userDoc as any).aiDialerAccruedCents = 0;
  }
  if (typeof (userDoc as any).aiDialerBilledTotalCents !== "number") {
    (userDoc as any).aiDialerBilledTotalCents = 0;
  }

  const billableCents = Math.max(0, Math.round(billableAmountUsd * 100));
  if (billableCents > 0) {
    (userDoc as any).aiDialerAccruedCents = Number((userDoc as any).aiDialerAccruedCents || 0) + billableCents;
  }

  const canBill = !!userDoc.stripeCustomerId && !DEV_SKIP_BILLING;

  // Charge in $20 increments when accrued reaches threshold
  if (canBill && Number((userDoc as any).aiDialerAccruedCents || 0) >= AI_DIALER_TOPUP_CENTS) {
    try {
      const accrued = Number((userDoc as any).aiDialerAccruedCents || 0);
      const increments = Math.floor(accrued / AI_DIALER_TOPUP_CENTS);
      const billCents = increments * AI_DIALER_TOPUP_CENTS;

      if (billCents > 0) {
        await createAndChargeInvoice({
          customerId: userDoc.stripeCustomerId!,
          amountCents: billCents,
          description: `CoveCRM AI Dialer usage charge ($${(billCents / 100).toFixed(2)})`,
        });

        (userDoc as any).aiDialerAccruedCents = accrued - billCents;
        (userDoc as any).aiDialerBilledTotalCents =
          Number((userDoc as any).aiDialerBilledTotalCents || 0) + billCents;
        (userDoc as any).aiDialerLastInvoicedAt = new Date();

        // Keep aiDialerUsage.billedAmount aligned with ACTUAL billed total
        const billedTotalUsd = Number((userDoc as any).aiDialerBilledTotalCents || 0) / 100;
        userDoc.aiDialerUsage = {
          vendorCost: prevUsage.vendorCost + vendorCostUsd,
          billedMinutes: prevUsage.billedMinutes + minutes,
          billedAmount: billedTotalUsd,
          lastChargedAt: new Date(),
        };

        console.log(
          `💳 AI Dialer invoice: $${(billCents / 100).toFixed(2)} charged to ${userDoc.email}`
        );
      }
    } catch (err) {
      console.error("❌ Stripe AI Dialer threshold charge failed:", err);
      // Do not throw; keep accrued so we can retry next usage
    }
  } else if (!canBill && !isProd && Number((userDoc as any).aiDialerAccruedCents || 0) >= AI_DIALER_TOPUP_CENTS) {
    console.warn("[DEV AI Dialer billing] Threshold reached but billing disabled/unavailable; accrued will remain until enabled.");
  }

  await userDoc.save();
}
