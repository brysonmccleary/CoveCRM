// /lib/billing/trackUsage.ts
import mongoose from "mongoose";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

/** ========= Env / Flags ========= */
const isProd = process.env.NODE_ENV === "production";
const DEV_SKIP_BILLING = process.env.DEV_SKIP_BILLING === "1";

/**
 * Percentage markup you want to charge over your raw vendor cost.
 * Example: 33 => 33% markup. If unset/invalid, defaults to 0.
 */
const USAGE_MARKUP_PCT = Number(process.env.USAGE_MARKUP_PCT ?? "33");
const MARKUP_FACTOR = Number.isFinite(USAGE_MARKUP_PCT) && USAGE_MARKUP_PCT > 0
  ? 1 + USAGE_MARKUP_PCT / 100
  : 1;

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
async function ensureDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
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

/** ========= Public APIs ========= */

type UsageSource = "twilio" | "twilio-self" | "twilio-voice" | "openai";

/**
 * Track usage (Twilio/OpenAI).
 * - We maintain analytics on *raw* vendor costs (no markup) in userDoc.aiUsage.
 * - We decrement usageBalance by the *billed* amount (raw * MARKUP_FACTOR)
 *   for platform-billed sources: "twilio", "twilio-voice", "openai".
 * - "twilio-self" should pass amount=0 — nothing is billed (still counted in totals if you want).
 */
export async function trackUsage({
  user,
  amount,
  source = "twilio",
}: {
  user: any;
  amount: number; // raw vendor cost in USD (e.g., your Twilio/OpenAI cost)
  source?: UsageSource;
}) {
  await ensureDb();
  const userDoc = await ensureMongooseDoc(user);

  if (!userDoc) {
    if (isProd) throw new Error("User missing");
    console.warn("[DEV billing] No valid user doc. Skipping billing checks.");
    return;
  }

  // ---- Analytics (store RAW costs) ----
  const addToTwilio =
    source === "twilio" || source === "twilio-voice" || source === "twilio-self";
  const addToOpenAI = source === "openai";

  userDoc.aiUsage = {
    ...userDoc.aiUsage,
    twilioCost: (userDoc.aiUsage?.twilioCost || 0) + (addToTwilio ? amount : 0),
    openAiCost: (userDoc.aiUsage?.openAiCost || 0) + (addToOpenAI ? amount : 0),
    totalCost: (userDoc.aiUsage?.totalCost || 0) + amount,
  };

  // Admins never charged
  if (!shouldBill(userDoc.email)) {
    await userDoc.save();
    return;
  }

  // If it's explicitly self-billed (amount typically 0), don't decrement balance
  const platformBilled =
    source === "twilio" || source === "twilio-voice" || source === "openai";

  // Hard freeze if too negative
  if ((userDoc.usageBalance || 0) < -20) {
    console.warn(`⛔ Usage frozen for ${userDoc.email} — balance too negative.`);
    if (isProd)
      throw new Error("Usage suspended. Please update your payment method.");
    await userDoc.save();
    return;
  }

  // ----- Decrement balance by the BILLED amount (raw * markup) -----
  const billedAmount = platformBilled ? amount * MARKUP_FACTOR : 0;
  userDoc.usageBalance = (userDoc.usageBalance || 0) - billedAmount;

  const canBill = !!userDoc.stripeCustomerId && !(DEV_SKIP_BILLING && isProd);

  if (!userDoc.stripeCustomerId) {
    if (isProd) {
      await userDoc.save();
      throw new Error("User missing or not linked to Stripe");
    } else {
      console.warn("[DEV billing] No Stripe customer; skipping auto top-up.");
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
      console.log(`💰 Auto-topup: $${TOPUP_AMOUNT_USD} charged to ${userDoc.email}`);
    } catch (err) {
      console.error("❌ Stripe auto top-up failed:", err);
    }
  } else if (userDoc.usageBalance < 1 && !canBill && !isProd) {
    console.warn(
      "[DEV billing] Balance < $1 but billing disabled/unavailable; continuing for testing.",
    );
  }

  await userDoc.save();
}

/**
 * One-time A2P approval charge (idempotent)
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

  if (!shouldBill(userDoc.email)) {
    return { charged: false, reason: "admin" };
  }

  const approved =
    userDoc?.a2p?.status === "approved" ||
    userDoc?.twilio?.a2pStatus === "approved" ||
    userDoc?.messagingReady === true;

  if (!approved) {
    return { charged: false, reason: "not-approved" };
  }

  if (!userDoc.stripeCustomerId || (DEV_SKIP_BILLING && isProd)) {
    return { charged: false, pending: true };
  }

  const customer = (await stripe.customers.retrieve(
    userDoc.stripeCustomerId,
  )) as any;

  if (customer?.deleted) {
    return { charged: false, pending: true };
  }

  const meta = customer?.metadata || {};
  const already =
    String(meta["a2p_approval_charged"] || "").toLowerCase() === "true";

  if (already) return { charged: false, reason: "already-charged" };

  await createAndChargeInvoice({
    customerId: userDoc.stripeCustomerId,
    amountCents: A2P_APPROVAL_FEE_CENTS,
    description: `A2P 10DLC registration approval fee ($${A2P_APPROVAL_FEE_USD})`,
  });

  await stripe.customers.update(userDoc.stripeCustomerId, {
    metadata: { ...meta, a2p_approval_charged: "true" },
  });

  return { charged: true };
}
