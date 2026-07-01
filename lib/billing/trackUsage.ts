// /lib/billing/trackUsage.ts
import mongoose from "mongoose";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { stripe } from "@/lib/stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";
import BillingEvent, { type BillingEventSource } from "@/models/BillingEvent";

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

// Sources that require account eligibility verification before charging.
const USAGE_SOURCES: BillingEventSource[] = [
  "ai_voice_session",
  "ai_transcript",
  "regular_usage",
];

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
 * Create a BillingEvent ledger entry, then create an invoice item, draft an
 * invoice, finalize it, and pay immediately — all idempotent.
 *
 * Idempotency key is derived deterministically from source + sourceId + amountCents
 * so retries always hit the same Stripe objects (no duplicate charges even if the
 * MongoDB deduction fails after Stripe succeeds).
 *
 * The BillingEvent unique index on (source, sourceId, amountCents) provides a
 * second layer: if the event is already "paid", we return immediately before
 * touching Stripe at all.
 */
export async function createFinalizePayInvoice(params: {
  customerId: string;
  amountCents: number;
  description: string;
  source: BillingEventSource;
  sourceId: string;
  userEmail?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  // ── Outermost kill switch ─────────────────────────────────────────────────────
  assertStripeWritesEnabled();

  const { customerId, amountCents, description, source, sourceId, userEmail, userId, metadata } =
    params;

  // ── Idempotency key (stable, derived from billing facts) ─────────────────────
  const idempotencyKey = `billing_${source}_${sourceId}_${amountCents}`;

  // ── Belt-and-suspenders kill switch ──────────────────────────────────────────
  if (process.env.DISABLE_ALL_STRIPE_BILLING === "1") {
    console.error("[BILLING BLOCKED] DISABLE_ALL_STRIPE_BILLING=1", {
      customerId, amountCents, description, source, sourceId, idempotencyKey,
    });
    await BillingEvent.findOneAndUpdate(
      { source, sourceId, amountCents },
      {
        $set: { status: "blocked", blockedReason: "DISABLE_ALL_STRIPE_BILLING", updatedAt: new Date() },
        $setOnInsert: {
          userEmail: userEmail || "", userId: userId || "", stripeCustomerId: customerId,
          description, idempotencyKey, metadata: metadata || {}, createdAt: new Date(),
        },
      },
      { upsert: true },
    ).catch(() => {/* non-fatal */});
    throw new Error("Stripe billing is globally disabled");
  }

  // ── Safety cap (default $50) ─────────────────────────────────────────────────
  const BILLING_SINGLE_CHARGE_CAP_CENTS = Number(
    process.env.BILLING_SINGLE_CHARGE_CAP_CENTS || "5000",
  );
  if (!Number.isFinite(BILLING_SINGLE_CHARGE_CAP_CENTS) || BILLING_SINGLE_CHARGE_CAP_CENTS <= 0) {
    throw new Error("Invalid BILLING_SINGLE_CHARGE_CAP_CENTS");
  }

  // Per-source cap: AI voice session capped at $20 by default
  let effectiveCapCents = BILLING_SINGLE_CHARGE_CAP_CENTS;
  if (source === "ai_voice_session") {
    const aiVoiceCap = Number(process.env.AI_VOICE_SINGLE_CHARGE_CAP_CENTS || "2000");
    if (Number.isFinite(aiVoiceCap) && aiVoiceCap > 0) {
      effectiveCapCents = Math.min(effectiveCapCents, aiVoiceCap);
    }
  }

  if (amountCents > effectiveCapCents) {
    const blockedReason = `charge_${amountCents}_exceeds_cap_${effectiveCapCents}`;
    console.error("[BILLING ANOMALY BLOCKED] Single charge exceeds cap", {
      customerId, amountCents, cap: effectiveCapCents, source, sourceId,
    });
    await BillingEvent.findOneAndUpdate(
      { source, sourceId, amountCents },
      {
        $set: { status: "blocked", blockedReason, updatedAt: new Date() },
        $setOnInsert: {
          userEmail: userEmail || "", userId: userId || "", stripeCustomerId: customerId,
          description, idempotencyKey, metadata: metadata || {}, createdAt: new Date(),
        },
      },
      { upsert: true },
    ).catch(() => {/* non-fatal */});
    throw new Error(`Billing anomaly blocked: ${amountCents}c exceeds cap of ${effectiveCapCents}c`);
  }

  // ── Account eligibility guard (usage-style sources) ──────────────────────────
  // Belt-and-suspenders: callers already check this, but the central helper
  // verifies independently so a mis-wired caller cannot charge ineligible accounts.
  if (USAGE_SOURCES.includes(source) && userEmail && !isAdminEmail(userEmail)) {
    const eligUser = await User.findOne({ email: userEmail.toLowerCase() })
      .select("hasEverPaid billingBlocked stripeCustomerId")
      .lean();

    const eligible =
      eligUser &&
      (eligUser as any).hasEverPaid === true &&
      (eligUser as any).billingBlocked !== true &&
      (eligUser as any).stripeCustomerId;

    if (!eligible) {
      const blockedReason = !eligUser
        ? "user_not_found"
        : !(eligUser as any).hasEverPaid
        ? "has_ever_paid_false"
        : (eligUser as any).billingBlocked
        ? "billing_blocked"
        : "no_stripe_customer";

      await BillingEvent.findOneAndUpdate(
        { source, sourceId, amountCents },
        {
          $set: { status: "blocked", blockedReason, updatedAt: new Date() },
          $setOnInsert: {
            userEmail: userEmail || "", userId: userId || "", stripeCustomerId: customerId,
            description, idempotencyKey, metadata: metadata || {}, createdAt: new Date(),
          },
        },
        { upsert: true },
      ).catch(() => {/* non-fatal */});

      console.warn("[BILLING ELIGIBILITY BLOCKED]", { userEmail, source, sourceId, blockedReason });
      throw new Error(`Billing blocked: ${blockedReason}`);
    }
  }

  // ── BillingEvent ledger — idempotency guard ───────────────────────────────────
  // $setOnInsert fires only if this is a NEW document (first attempt).
  // If the document already exists, we get back the previous state.
  const existingEvent = await BillingEvent.findOneAndUpdate(
    { source, sourceId, amountCents },
    {
      $setOnInsert: {
        userEmail: userEmail || "",
        userId: userId || "",
        stripeCustomerId: customerId,
        description,
        status: "pending",
        idempotencyKey,
        metadata: metadata || {},
        createdAt: new Date(),
      },
      $set: { updatedAt: new Date() },
    },
    { upsert: true, new: false },
  ).catch(async (err: any) => {
    // Duplicate key race on concurrent upserts — find the winner
    if (err.code === 11000) {
      return BillingEvent.findOne({ source, sourceId, amountCents }).lean();
    }
    throw err;
  });

  if (existingEvent) {
    const st = String((existingEvent as any).status || "");
    // Already fully paid — no Stripe write needed
    if (st === "paid") {
      console.log("[BILLING SKIPPED] Already paid", { source, sourceId, idempotencyKey });
      return;
    }
    // Invoice created in Stripe and handed off — skip re-creation
    if (st === "stripe_created" && (existingEvent as any).stripeInvoiceId) {
      console.log("[BILLING SKIPPED] Stripe invoice already created", {
        source, sourceId, stripeInvoiceId: (existingEvent as any).stripeInvoiceId,
      });
      return;
    }
    // For "pending", "failed", "blocked" (now eligible): proceed and retry Stripe calls.
    // Stripe idempotency keys guarantee the same invoice is returned on retry.
    if (st === "blocked") {
      await BillingEvent.updateOne(
        { source, sourceId, amountCents },
        { $set: { status: "pending", blockedReason: undefined, updatedAt: new Date() } },
      ).catch(() => {/* non-fatal */});
    }
  }

  // ── Audit log ────────────────────────────────────────────────────────────────
  console.log("[BILLING ATTEMPT]", {
    customerId, amountCents, description, source, sourceId,
    idempotencyKey, cap: effectiveCapCents,
  });

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

    // Mark Stripe objects created — idempotent retry of finalize/pay is now safe
    await BillingEvent.updateOne(
      { source, sourceId, amountCents },
      {
        $set: {
          status: "stripe_created",
          stripeInvoiceItemId: invoiceItemId,
          stripeInvoiceId: invoiceId,
          updatedAt: new Date(),
        },
      },
    ).catch(() => {/* non-fatal — Stripe idempotency still protects us */});

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

    // ── Mark paid — idempotency guard for future retries ─────────────────────
    await BillingEvent.updateOne(
      { source, sourceId, amountCents },
      {
        $set: {
          status: "paid",
          stripeInvoiceItemId: invoiceItemId,
          stripeInvoiceId: invoiceId,
          updatedAt: new Date(),
        },
      },
    ).catch(() => {
      // Non-fatal: if this fails, next retry sees same Stripe idempotency key
      // and gets the same already-paid invoice → no duplicate charge.
      console.error("[BILLING] BillingEvent 'paid' update failed; Stripe idempotency is the safety net", {
        source, sourceId, idempotencyKey,
      });
    });

    console.log("[BILLING SUCCESS]", {
      customerId, amountCents, description, source, sourceId,
      idempotencyKey, invoiceItemId, invoiceId,
    });
  } catch (err) {
    // Clean up orphaned item if invoice was never created
    if (invoiceItemId && !invoiceId) {
      try {
        await stripe.invoiceItems.del(invoiceItemId);
      } catch {
        /* ignore cleanup failure */
      }
    }
    // Mark failed — keeps audit trail; next retry resets to "pending" above
    await BillingEvent.updateOne(
      { source, sourceId, amountCents },
      { $set: { status: "failed", updatedAt: new Date() } },
    ).catch(() => {/* non-fatal */});
    throw err;
  }
}

/** ========= Public APIs ========= */

type UsageSource =
  | "twilio"
  | "twilio-self"
  | "twilio-voice"
  | "openai"
  | "ai-dialer";

/**
 * Track billable usage for the REGULAR bucket ($10 threshold).
 *
 * Covers: browser dialer, manual dialer, inbound voice, SMS/MMS, drips,
 * appointment texts, transcriptions, call coaching, and non-AI-voice OpenAI.
 *
 * AI Voice is a separate bucket handled entirely by trackAiDialerSessionUsage().
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

  // ai-dialer has its own $20 bucket — excluded here
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
    // Include usageBilledTotalCents for stable BillingEvent sourceId
    { new: true, projection: { usageAccruedCents: 1, usageBilledTotalCents: 1 } },
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

  // sourceId encodes: "user X's cumulative billing reaching Y cents".
  // If Stripe charges but MongoDB deduction fails → next retry computes the
  // same sourceId → BillingEvent already "paid" → no duplicate charge.
  const currentBilledTotal = Number((locked as any).usageBilledTotalCents || 0);
  const sourceId = `usage:${userDoc.email}:${currentBilledTotal + billCents}`;
  const stripeCustomerId = userDoc.stripeCustomerId as string;

  try {
    await createFinalizePayInvoice({
      customerId: stripeCustomerId,
      amountCents: billCents,
      description: `Cove CRM usage charge ($${(billCents / 100).toFixed(2)})`,
      source: "regular_usage",
      sourceId,
      userEmail: userDoc.email as string,
      userId: String(userDoc._id),
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
 * One-time A2P approval charge (idempotent via BillingEvent unique index).
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

  const customer = (await stripe.customers.retrieve(userDoc.stripeCustomerId)) as any;

  if (customer?.deleted) {
    return { charged: false, pending: true };
  }

  // Check BillingEvent first (idempotency via unique index on source+sourceId+amountCents)
  const sourceId = `a2p:${userDoc.stripeCustomerId}`;
  const existing = await BillingEvent.findOne({
    source: "a2p_fee",
    sourceId,
    amountCents: A2P_APPROVAL_FEE_CENTS,
  }).lean();
  if (existing && (existing as any).status === "paid") {
    return { charged: false, reason: "already-charged" };
  }

  // Fallback: also check Stripe customer metadata (legacy path)
  const meta = customer?.metadata || {};
  const alreadyInMeta =
    String(meta["a2p_approval_charged"] || "").toLowerCase() === "true";
  if (alreadyInMeta) return { charged: false, reason: "already-charged" };

  assertStripeWritesEnabled();
  await createFinalizePayInvoice({
    customerId: userDoc.stripeCustomerId,
    amountCents: A2P_APPROVAL_FEE_CENTS,
    description: `A2P 10DLC registration approval fee ($${A2P_APPROVAL_FEE_USD})`,
    source: "a2p_fee",
    sourceId,
    userEmail: userDoc.email as string,
    userId: String(userDoc._id),
  });

  await stripe.customers.update(userDoc.stripeCustomerId, {
    metadata: { ...meta, a2p_approval_charged: "true" },
  });

  return { charged: true };
}
