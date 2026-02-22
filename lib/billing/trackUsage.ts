// /lib/billing/trackUsage.ts
import mongoose from "mongoose";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
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

  // Platform-billed sources only (twilio, twilio-voice, openai). Self-billed should pass amount=0.
  const platformBilled =
    source === "twilio" || source === "twilio-voice" || source === "openai";

  const canBill = !!userDoc.stripeCustomerId && !(DEV_SKIP_BILLING && isProd);

  // Missing Stripe linkage in prod should block billing
  if (!userDoc.stripeCustomerId) {
    if (isProd && platformBilled && amount > 0) {
      await userDoc.save();
      throw new Error("User missing or not linked to Stripe");
    }
  }

  // ✅ GHL-style: accrue billed usage (NOT vendor cost) and invoice only when threshold reached.
  // Amount is USD you charge (no markup).
  const addCents = platformBilled && amount > 0 ? Math.max(0, Math.round(amount * 100)) : 0;

  if (addCents > 0) {
    userDoc.usageAccruedCents = (userDoc.usageAccruedCents || 0) + addCents;
  }

  // Invoice in $10 increments when accrued reaches threshold
  if (platformBilled && canBill && (userDoc.usageAccruedCents || 0) >= TOPUP_AMOUNT_CENTS) {
    try {
      const accrued = Number(userDoc.usageAccruedCents || 0);
      const increments = Math.floor(accrued / TOPUP_AMOUNT_CENTS);
      const billCents = increments * TOPUP_AMOUNT_CENTS;

      if (billCents > 0) {
        await createAndChargeInvoice({
          customerId: userDoc.stripeCustomerId!,
          amountCents: billCents,
          description: `Cove CRM usage charge ($${(billCents / 100).toFixed(2)})`,
        });

        userDoc.usageAccruedCents = accrued - billCents;
        userDoc.usageBilledTotalCents = (userDoc.usageBilledTotalCents || 0) + billCents;
        userDoc.usageLastInvoicedAt = new Date();
        console.log(`💳 Usage invoice: $${(billCents / 100).toFixed(2)} charged to ${userDoc.email}`);
      }
    } catch (err) {
      console.error("❌ Stripe usage threshold charge failed:", err);
      // Do not throw; keep accrued so we can retry next usage
    }
  } else if (!canBill && !isProd && platformBilled && (userDoc.usageAccruedCents || 0) >= TOPUP_AMOUNT_CENTS) {
    console.warn("[DEV billing] Threshold reached but billing disabled/unavailable; accrued will remain until enabled.");
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

  const a2p = userDoc.a2p || {};

  // Align with syncA2PForUser:
  //  - a2p.messagingReady === true
  //  - a2p.applicationStatus === 'approved'
  //  - a2p.registrationStatus === 'ready'
  //  - legacy: twilio.a2pStatus === 'approved'
  let approved =
    a2p.messagingReady === true ||
    a2p.applicationStatus === "approved" ||
    a2p.registrationStatus === "ready" ||
    userDoc?.twilio?.a2pStatus === "approved";

  // ✅ Also accept A2PProfile as truth (our A2P system now writes here)
  if (!approved) {
    try {
      const prof: any = await A2PProfile.findOne({ userId: String(userDoc._id) });
      if (prof) {
        const reg = String(prof.registrationStatus || "").toLowerCase();
        const app = String(prof.applicationStatus || "").toLowerCase();
        approved =
          prof.messagingReady === true ||
          app === "approved" ||
          reg === "campaign_approved" ||
          reg === "ready";
      }
    } catch {
      // non-fatal; fall through
    }
  }

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
