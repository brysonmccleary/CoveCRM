// /lib/billing/trackUsage.ts
import mongoose from "mongoose";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { stripe } from "@/lib/stripe";

/** ========= Env / Flags ========= */
const isProd = process.env.NODE_ENV === "production";
const DEV_SKIP_BILLING = process.env.DEV_SKIP_BILLING === "1";
const TOPUP_AMOUNT_USD = 10;
const TOPUP_AMOUNT_CENTS = TOPUP_AMOUNT_USD * 100;

const A2P_APPROVAL_FEE_USD = 15;
const A2P_APPROVAL_FEE_CENTS = A2P_APPROVAL_FEE_USD * 100;

// Lock ownership window. Stripe charges complete in <15s in practice; 10min is a
// very generous TTL that only matters if the process dies mid-charge.
const BILLING_LOCK_TTL_MS = 10 * 60 * 1000;

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

/**
 * Create an invoice item, draft an invoice, finalize it, and pay immediately.
 *
 * Replaces the old auto_advance:true pattern, which scheduled an async Stripe
 * sweep instead of charging now. Idempotency keys make retries safe.
 *
 * If invoice creation fails after the item is created, the orphaned item is
 * deleted to prevent it from attaching to a future invoice unexpectedly.
 */
export async function createFinalizePayInvoice(params: {
  customerId: string;
  amountCents: number;
  description: string;
  idempotencyKey: string;
}): Promise<void> {
  const { customerId, amountCents, description, idempotencyKey } = params;
  let invoiceItemId: string | undefined;
  let invoiceId: string | undefined;

  try {
    const item = await stripe.invoiceItems.create(
      { customer: customerId, amount: amountCents, currency: "usd", description },
      { idempotencyKey: `item_${idempotencyKey}` },
    );
    invoiceItemId = item.id;

    const invoice = await stripe.invoices.create(
      {
        customer: customerId,
        collection_method: "charge_automatically",
        auto_advance: false,
      },
      { idempotencyKey: `inv_${idempotencyKey}` },
    );
    invoiceId = invoice.id;

    await stripe.invoices.finalizeInvoice(
      invoiceId!,
      {},
      { idempotencyKey: `fin_${idempotencyKey}` },
    );

    await stripe.invoices.pay(
      invoiceId!,
      {},
      { idempotencyKey: `pay_${idempotencyKey}` },
    );
  } catch (err) {
    // Clean up orphaned item if invoice was never created
    if (invoiceItemId && !invoiceId) {
      try {
        await stripe.invoiceItems.del(invoiceItemId);
      } catch {
        /* ignore cleanup failure */
      }
    }
    throw err;
  }
}

/** ========= Public APIs ========= */

type UsageSource =
  | "twilio"
  | "twilio-self"
  | "twilio-voice"
  | "openai"
  | "ai-dialer"; // Deprecated: pass source:"ai-dialer" is now a no-op; use trackAiDialerUsage directly

/**
 * Track billable usage for the REGULAR bucket ($10 threshold).
 *
 * Covers: browser dialer, manual dialer, inbound voice, SMS/MMS, drips,
 * appointment texts, transcriptions, call coaching, and non-AI-voice OpenAI.
 *
 * AI Voice is a separate bucket handled entirely by trackAiDialerUsage().
 * Passing source:"ai-dialer" here does NOT accrue to the regular bucket.
 *
 * Accrual and threshold charging are fully atomic — no read-modify-write race.
 */
export async function trackUsage({
  user,
  amount,
  source = "twilio",
}: {
  user: any;
  amount: number;
  source?: UsageSource;
}) {
  await ensureDb();
  const userDoc = await ensureMongooseDoc(user);

  if (!userDoc) {
    if (isProd) throw new Error("User missing");
    console.warn("[DEV billing] No valid user doc. Skipping billing checks.");
    return;
  }

  // ai-dialer has its own $20 bucket in trackAiDialerUsage — excluded here
  const platformBilled =
    source === "twilio" || source === "twilio-voice" || source === "openai";

  const addToTwilio =
    source === "twilio" || source === "twilio-voice" || source === "twilio-self";
  const addToOpenAI = source === "openai";

  // Analytics fields to increment (atomic — always runs, even for admins)
  const analyticsInc: Record<string, number> = {};
  if (amount !== 0) {
    analyticsInc["aiUsage.totalCost"] = amount;
    if (addToTwilio) analyticsInc["aiUsage.twilioCost"] = amount;
    if (addToOpenAI) analyticsInc["aiUsage.openAiCost"] = amount;
  }

  // Admins get analytics only — never billed
  if (!shouldBill(userDoc.email)) {
    if (Object.keys(analyticsInc).length > 0) {
      await User.updateOne({ email: userDoc.email }, { $inc: analyticsInc });
    }
    return;
  }

  const addCents =
    platformBilled && amount > 0 ? Math.max(0, Math.round(amount * 100)) : 0;

  if (!userDoc.stripeCustomerId && isProd && platformBilled && amount > 0) {
    if (Object.keys(analyticsInc).length > 0) {
      await User.updateOne({ email: userDoc.email }, { $inc: analyticsInc });
    }
    throw new Error("User missing or not linked to Stripe");
  }

  const canBill = !!userDoc.stripeCustomerId && !(DEV_SKIP_BILLING && isProd);

  // One atomic round trip: update analytics + accrue usage
  const incFields: Record<string, number> = { ...analyticsInc };
  if (addCents > 0) incFields["usageAccruedCents"] = addCents;

  const updated = await User.findOneAndUpdate(
    { email: userDoc.email },
    { $inc: incFields },
    { new: true, projection: { usageAccruedCents: 1, stripeCustomerId: 1 } },
  );

  if (!updated) return;

  const newAccrued = Number((updated as any).usageAccruedCents || 0);

  if (!canBill && !isProd && platformBilled && newAccrued >= TOPUP_AMOUNT_CENTS) {
    console.warn(
      "[DEV billing] Threshold reached but billing unavailable; accrual remains until enabled.",
    );
    return;
  }

  if (!canBill || !platformBilled || newAccrued < TOPUP_AMOUNT_CENTS) return;

  // ── Acquire exclusive billing lock ──────────────────────────────────────────
  // Conditional update: only succeeds if no lock is held (or existing lock has
  // expired). The unique lockOwner ID ensures only this process can commit.
  const lockOwner = new mongoose.Types.ObjectId().toString();
  const lockExpiresAt = new Date(Date.now() + BILLING_LOCK_TTL_MS);

  const locked = await User.findOneAndUpdate(
    {
      email: userDoc.email,
      usageAccruedCents: { $gte: TOPUP_AMOUNT_CENTS },
      $or: [
        { billingLockAt: null },
        { billingLockExpiresAt: { $lt: new Date() } },
      ],
    },
    {
      $set: {
        billingLockAt: new Date(),
        billingLockOwner: lockOwner,
        billingLockExpiresAt: lockExpiresAt,
      },
    },
    { new: true, projection: { usageAccruedCents: 1 } },
  );

  if (!locked) return; // another process holds the lock; accrual is safely stored

  const accrued = Number((locked as any).usageAccruedCents || 0);
  const increments = Math.floor(accrued / TOPUP_AMOUNT_CENTS);
  const billCents = increments * TOPUP_AMOUNT_CENTS;

  if (billCents <= 0) {
    await User.updateOne(
      { email: userDoc.email, billingLockOwner: lockOwner },
      { $set: { billingLockAt: null, billingLockOwner: null, billingLockExpiresAt: null } },
    );
    return;
  }

  // lockOwner is unique per billing attempt → idempotency key is stable for retries
  const idempotencyKey = `reg_${userDoc.email}_${lockOwner}`;
  const stripeCustomerId = (userDoc.stripeCustomerId as string);

  try {
    await createFinalizePayInvoice({
      customerId: stripeCustomerId,
      amountCents: billCents,
      description: `Cove CRM usage charge ($${(billCents / 100).toFixed(2)})`,
      idempotencyKey,
    });

    // Commit: only our lockOwner can execute this write
    await User.findOneAndUpdate(
      { email: userDoc.email, billingLockOwner: lockOwner },
      {
        $inc: { usageAccruedCents: -billCents, usageBilledTotalCents: billCents },
        $set: {
          usageLastInvoicedAt: new Date(),
          billingLockAt: null,
          billingLockOwner: null,
          billingLockExpiresAt: null,
        },
      },
    );
    console.log(
      `💳 Usage invoice: $${(billCents / 100).toFixed(2)} charged to ${userDoc.email}`,
    );
  } catch (err) {
    console.error("❌ Stripe usage threshold charge failed:", err);
    // Release lock only — keep accrual so next event retries the charge
    await User.updateOne(
      { email: userDoc.email, billingLockOwner: lockOwner },
      { $set: { billingLockAt: null, billingLockOwner: null, billingLockExpiresAt: null } },
    );
    // Do NOT throw — must not crash Twilio webhooks or block active calls
  }
}

/**
 * One-time A2P approval charge (idempotent via Stripe customer metadata).
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

  let approved =
    a2p.messagingReady === true ||
    a2p.applicationStatus === "approved" ||
    a2p.registrationStatus === "ready" ||
    (userDoc as any)?.twilio?.a2pStatus === "approved";

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

  // Idempotency key is stable per-customer — safe to retry if this call fails
  await createFinalizePayInvoice({
    customerId: userDoc.stripeCustomerId,
    amountCents: A2P_APPROVAL_FEE_CENTS,
    description: `A2P 10DLC registration approval fee ($${A2P_APPROVAL_FEE_USD})`,
    idempotencyKey: `a2p_${userDoc.stripeCustomerId}`,
  });

  await stripe.customers.update(userDoc.stripeCustomerId, {
    metadata: { ...meta, a2p_approval_charged: "true" },
  });

  return { charged: true };
}
