// /lib/billing/trackUsage.ts
import mongoose from "mongoose";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

/** ========= Env / Flags ========= */
const isProd = process.env.NODE_ENV === "production";
const DEV_SKIP_BILLING = process.env.DEV_SKIP_BILLING === "1";

const TOPUP_AMOUNT_USD = 10; // Auto top-up when balance < $1
const TOPUP_AMOUNT_CENTS = TOPUP_AMOUNT_USD * 100;

const A2P_APPROVAL_FEE_USD = 15;
const A2P_APPROVAL_FEE_CENTS = A2P_APPROVAL_FEE_USD * 100;

/** ========= Admin allow-list ========= */
function isAdminEmail(email?: string | null) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

function shouldBill(email?: string | null) {
  return !isAdminEmail(email);
}

/** ========= Helpers ========= */

async function ensureDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

/** Ensures we have a real Mongoose document for the user */
async function ensureMongooseDoc(user: any) {
  if (!user) return null;

  // Already a Mongoose doc
  if (typeof user.save === "function") {
    return user;
  }

  // Try fetching by _id if available
  if (user._id && mongoose.isValidObjectId(user._id)) {
    const doc = await User.findById(user._id);
    if (doc) return doc;
  }

  // Try fetching by email
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

  // Create an invoice item for a fixed amount (no Price object)
  await stripe.invoiceItems.create({
    customer: customerId,
    amount: amountCents,
    currency: "usd",
    description,
  });

  // Create and auto-charge the invoice
  await stripe.invoices.create({
    customer: customerId,
    collection_method: "charge_automatically",
    auto_advance: true,
  });
}

/** ========= Public APIs ========= */

/**
 * Track Twilio/OpenAI usage.
 * - Admin emails (ADMIN_EMAILS) are never billed; we still record AI usage counters.
 * - In prod for non-admins, requires stripeCustomerId; auto top-up $10 when balance < $1.
 */
export async function trackUsage({
  user,
  amount,
  source = "twilio",
}: {
  user: any;
  amount: number;
  source?: "twilio" | "openai";
}) {
  await ensureDb();

  const userDoc = await ensureMongooseDoc(user);

  if (!userDoc) {
    if (isProd) throw new Error("User missing");
    console.warn("[DEV billing] No valid user doc. Skipping billing checks.");
    return;
  }

  // Always record usage counters
  userDoc.aiUsage = {
    ...userDoc.aiUsage,
    twilioCost:
      (userDoc.aiUsage?.twilioCost || 0) + (source === "twilio" ? amount : 0),
    openAiCost:
      (userDoc.aiUsage?.openAiCost || 0) + (source === "openai" ? amount : 0),
    totalCost: (userDoc.aiUsage?.totalCost || 0) + amount,
  };

  /** Admin accounts never decrement balance or get charged */
  if (!shouldBill(userDoc.email)) {
    await userDoc.save();
    return;
  }

  // Hard freeze if balance too negative
  if ((userDoc.usageBalance || 0) < -20) {
    console.warn(`⛔ Usage frozen for ${userDoc.email} — balance too negative.`);
    if (isProd)
      throw new Error("Usage suspended. Please update your payment method.");
    await userDoc.save();
    return;
  }

  // Subtract usage & update totals for non-admins
  userDoc.usageBalance = (userDoc.usageBalance || 0) - amount;

  const canBill = !!userDoc.stripeCustomerId && !(DEV_SKIP_BILLING && isProd);

  // Missing Stripe linkage
  if (!userDoc.stripeCustomerId) {
    if (isProd) {
      await userDoc.save();
      throw new Error("User missing or not linked to Stripe");
    } else {
      console.warn(
        "[DEV billing] User not linked to Stripe. Skipping auto-topup/charges."
      );
    }
  }

  // Auto-topup if needed (balance < $1)
  if (userDoc.usageBalance < 1 && canBill) {
    try {
      await createAndChargeInvoice({
        customerId: userDoc.stripeCustomerId!,
        amountCents: TOPUP_AMOUNT_CENTS,
        description: `Cove CRM usage top-up ($${TOPUP_AMOUNT_USD})`,
      });

      userDoc.usageBalance += TOPUP_AMOUNT_USD;
      console.log(
        `💰 Auto-topup: $${TOPUP_AMOUNT_USD} charged to ${userDoc.email}`
      );
    } catch (err) {
      console.error("❌ Stripe auto top-up failed:", err);
    }
  } else if (userDoc.usageBalance < 1 && !canBill && !isProd) {
    console.warn(
      "[DEV billing] Balance < $1 but billing disabled/unavailable; continuing for testing."
    );
  }

  await userDoc.save();
}

/**
 * Bill a one-time $15 fee when A2P is actually approved.
 * Idempotent via Stripe Customer metadata: `a2p_approval_charged=true`
 *
 * Approval detection tries several flags to match your Twilio sync logic:
 *  - userDoc.a2p?.status === 'approved'
 *  - userDoc.twilio?.a2pStatus === 'approved'
 *  - userDoc.messagingReady === true
 *
 * If the user is in ADMIN_EMAILS, no charge is made.
 * If Stripe customer is missing, we return { pending: true } and do not mark it charged.
 */
export async function chargeA2PApprovalIfNeeded({
  user,
}: {
  user: any;
}): Promise<
  | { charged: true }
  | { charged: false; reason: "not-approved" | "already-charged" | "admin" }
  | { charged: false; pending: true }
> {
  await ensureDb();

  const userDoc = await ensureMongooseDoc(user);
  if (!userDoc) {
    if (isProd) throw new Error("User missing");
    return { charged: false, reason: "not-approved" };
    }

  // Admins never get charged
  if (!shouldBill(userDoc.email)) {
    return { charged: false, reason: "admin" };
  }

  // Determine approval
  const approved =
    userDoc?.a2p?.status === "approved" ||
    userDoc?.twilio?.a2pStatus === "approved" ||
    userDoc?.messagingReady === true;

  if (!approved) {
    return { charged: false, reason: "not-approved" };
  }

  // Must have a Stripe customer to charge
  if (!userDoc.stripeCustomerId || (DEV_SKIP_BILLING && isProd)) {
    return { charged: false, pending: true };
  }

  // Retrieve customer + check idempotency flag
  const customer = (await stripe.customers.retrieve(
    userDoc.stripeCustomerId
  )) as any;

  if (customer?.deleted) {
    return { charged: false, pending: true };
  }

  const meta = customer?.metadata || {};
  const already =
    String(meta["a2p_approval_charged"] || "").toLowerCase() === "true";

  if (already) {
    return { charged: false, reason: "already-charged" };
  }

  // Charge $15 one-time
  await createAndChargeInvoice({
    customerId: userDoc.stripeCustomerId,
    amountCents: A2P_APPROVAL_FEE_CENTS,
    description: `A2P 10DLC registration approval fee ($${A2P_APPROVAL_FEE_USD})`,
  });

  // Mark idempotency on the Stripe customer
  await stripe.customers.update(userDoc.stripeCustomerId, {
    metadata: { ...meta, a2p_approval_charged: "true" },
  });

  return { charged: true };
}
