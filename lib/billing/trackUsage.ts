// /lib/billing/trackUsage.ts
import mongoose from "mongoose";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { stripe } from "@/lib/stripe";
import BillingEvent, { type BillingEventSource } from "@/models/BillingEvent";
import {
  settleStandaloneThresholdInvoice,
  validatePaidStandaloneInvoice,
  type ThresholdBucket,
} from "@/lib/billing/standaloneInvoice";
import {
  consumeAccrualLedgerCents,
  getPendingAccrualLedgerCents,
  recordUsageAccrualOnce,
} from "@/lib/billing/usageAccrualLedger";

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
  "ai_voice_call",
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

export { settleStandaloneThresholdInvoice } from "@/lib/billing/standaloneInvoice";

export async function createFinalizePayInvoice(params: {
  customerId: string;
  amountCents: number;
  description: string;
  source: BillingEventSource;
  sourceId: string;
  userEmail?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  bucket?: ThresholdBucket;
}) {
  await ensureDb();
  const bucket = params.bucket || (params.source === "a2p_fee" ? "a2p" : params.source.startsWith("ai_") ? "ai_voice" : "regular");
  return settleStandaloneThresholdInvoice({ ...params, bucket });
}

export async function applyUsageBillingEvent(args: {
  billingEventId: string;
  userId: string;
  userEmail: string;
  bucket: "regular" | "ai_voice";
  amountCents: number;
}) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const event = await BillingEvent.findOne({ _id: args.billingEventId, status: "paid" }).session(session);
      if (!event) return;
      const fields = args.bucket === "regular"
        ? { accrued: "usageAccruedCents", billed: "usageBilledTotalCents", last: "usageLastInvoicedAt" }
        : { accrued: "aiDialerAccruedSessionCents", billed: "aiDialerBilledTotalCents", last: "aiDialerLastChargedAt" };
      const user = await User.findOneAndUpdate(
        { _id: args.userId, [fields.accrued]: { $gte: args.amountCents } },
        { $inc: { [fields.accrued]: -args.amountCents, [fields.billed]: args.amountCents }, $set: { [fields.last]: new Date() } },
        { new: true, session },
      );
      if (!user) throw new Error("Paid billing event cannot be applied: bucket is below its settled threshold");
      const consumed = await consumeAccrualLedgerCents({
        bucket: args.bucket,
        userEmail: args.userEmail,
        amountCents: args.amountCents,
        session,
      });
      if (consumed !== args.amountCents) throw new Error("Paid billing event cannot be applied: accrual ledger shortfall");
      const marked = await BillingEvent.updateOne(
        { _id: args.billingEventId, status: "paid" },
        {
          $set: {
            status: "applied",
            appliedAt: new Date(),
            appliedBucket: args.bucket,
            appliedAmountCents: args.amountCents,
            needsApplicationReview: false,
            updatedAt: new Date(),
          },
          $unset: { applicationError: 1, applicationFailedAt: 1 },
        },
        { session },
      );
      if (Number((marked as any).modifiedCount || 0) !== 1) throw new Error("Paid billing event application was not claimed");
    });
  } finally {
    await session.endSession();
  }
}

export async function markBillingEventApplicationFailure(event: any, error: unknown) {
  const eventId = String(event?._id || "");
  if (!eventId) return;
  const message = String((error as any)?.message || error || "application failed").slice(0, 1000);
  await BillingEvent.updateOne(
    { _id: eventId, status: "paid" },
    {
      $set: {
        applicationError: message,
        applicationFailedAt: new Date(),
        needsApplicationReview: true,
        updatedAt: new Date(),
      },
      $inc: { applicationAttempts: 1 },
    },
  );
  console.error("[BILLING][PAID-UNAPPLIED]", {
    billingEventId: eventId,
    userEmail: event?.userEmail || "",
    bucket: event?.metadata?.bucket || "",
    amountCents: event?.amountCents || 0,
    invoiceId: event?.stripeInvoiceId || "",
    error: message,
  });
}

export async function applyPaidBillingEvent(event: any, recordFailure = true) {
  if (String(event?.status || "") === "applied") return;
  const bucket = String(event?.metadata?.bucket || "") as ThresholdBucket;
  try {
    if (bucket === "a2p") {
      await applyA2PBillingEvent(String(event._id));
      return;
    }
    if (bucket !== "regular" && bucket !== "ai_voice") {
      throw new Error("Paid BillingEvent has an invalid application bucket");
    }
    await applyUsageBillingEvent({
      billingEventId: String(event._id),
      userId: String(event.userId || ""),
      userEmail: String(event.userEmail || ""),
      bucket,
      amountCents: Number(event.amountCents || 0),
    });
  } catch (error) {
    if (recordFailure) await markBillingEventApplicationFailure(event, error);
    throw error;
  }
}

export async function recoverPaidBillingEvents(limit = 25) {
  const events = await BillingEvent.find({ status: "paid", appliedAt: null })
    .sort({ paidAt: 1, _id: 1 })
    .limit(Math.max(1, Math.min(100, Math.floor(limit))))
    .lean();
  let applied = 0;
  let failed = 0;
  for (const event of events as any[]) {
    try {
      await validatePaidStandaloneInvoice(event);
      await applyPaidBillingEvent(event, false);
      applied += 1;
    } catch (error) {
      failed += 1;
      await markBillingEventApplicationFailure(event, error).catch(() => undefined);
    }
  }
  return { scanned: events.length, applied, failed };
}

async function applyA2PBillingEvent(billingEventId: string) {
  await BillingEvent.updateOne(
    { _id: billingEventId, status: "paid" },
    {
      $set: {
        status: "applied",
        appliedAt: new Date(),
        appliedBucket: "a2p",
        appliedAmountCents: A2P_APPROVAL_FEE_CENTS,
        needsApplicationReview: false,
        updatedAt: new Date(),
      },
      $unset: { applicationError: 1, applicationFailedAt: 1 },
    },
  );
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
  eventKey,
  metadata,
}: {
  user: any;
  amount: number;
  source?: UsageSource;
  eventKey?: string;
  metadata?: Record<string, unknown>;
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

  if (addCents > 0 && !String(eventKey || "").trim()) {
    throw new Error(`Missing usage eventKey for ${source} accrual`);
  }

  if (!userDoc.stripeCustomerId && isProd && platformBilled && amount > 0) {
    if (Object.keys(analyticsInc).length > 0) {
      await User.updateOne({ email: userDoc.email }, { $inc: analyticsInc });
    }
    throw new Error("User missing or not linked to Stripe");
  }

  const canBill = !!userDoc.stripeCustomerId && !(DEV_SKIP_BILLING && isProd);

  const accrualEvent =
    addCents > 0
      ? await recordUsageAccrualOnce({
          bucket: "regular",
          userEmail: userDoc.email as string,
          eventKey: `regular:${eventKey}`,
          source,
          amountCents: addCents,
          origin: "regular",
          metadata: {
            ...(metadata || {}),
            amount,
            source,
          },
        })
      : { accrued: false, duplicate: false, amountCents: 0 };

  if (addCents > 0 && !accrualEvent.accrued) {
    return;
  }

  // One atomic round trip: update analytics + accrue usage
  const incFields: Record<string, number> = { ...analyticsInc };
  if (addCents > 0) incFields["usageAccruedCents"] = addCents;

  const updated = await User.findOneAndUpdate(
    { email: userDoc.email },
    { $inc: incFields },
    {
      new: true,
      projection: {
        usageAccruedCents: 1,
        stripeCustomerId: 1,
      },
    },
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
  const ledgerPendingCents = await getPendingAccrualLedgerCents({
    bucket: "regular",
    userEmail: userDoc.email as string,
  });
  if (accrued > ledgerPendingCents) {
    console.error("[BILLING][PRE-LEDGER-BALANCE-DRIFT]", {
      userEmail: userDoc.email,
      bucket: "regular",
      storedCents: accrued,
      ledgerBackedCents: ledgerPendingCents,
      unledgeredCents: accrued - ledgerPendingCents,
    });
  }
  // Bill exactly one ledger-backed threshold increment per event ($10 max).
  // Stored pre-ledger balance is never included unless backed by ledger rows.
  const billCents = ledgerPendingCents >= TOPUP_AMOUNT_CENTS ? TOPUP_AMOUNT_CENTS : 0;

  if (billCents <= 0) {
    await User.updateOne(
      { email: userDoc.email, billingLockOwner: lockOwner },
      { $set: { billingLockAt: null, billingLockOwner: null, billingLockExpiresAt: null } },
    );
    return;
  }

  // Sequence advances only after the event is atomically applied, so a retry
  // after Stripe collection uses the same immutable BillingEvent source id.
  const currentBilledTotal = Number((locked as any).usageBilledTotalCents || 0);
  const thresholdSequence = Math.floor(currentBilledTotal / TOPUP_AMOUNT_CENTS) + 1;
  const sourceId = `regular_usage:${String(userDoc._id)}:${thresholdSequence}`;
  const stripeCustomerId = userDoc.stripeCustomerId as string;

  try {
    const event = await createFinalizePayInvoice({
      customerId: stripeCustomerId,
      amountCents: billCents,
      description: `Cove CRM usage charge ($${(billCents / 100).toFixed(2)})`,
      source: "regular_usage",
      sourceId,
      userEmail: userDoc.email as string,
      userId: String(userDoc._id),
      bucket: "regular",
    });
    await applyPaidBillingEvent(event);
    await User.updateOne(
      { email: userDoc.email, billingLockOwner: lockOwner },
      { $set: { billingLockAt: null, billingLockOwner: null, billingLockExpiresAt: null } },
    );
    console.log(
      `💳 Usage invoice: $${(billCents / 100).toFixed(2)} charged to ${userDoc.email}`,
    );
  } catch (err) {
    console.error("❌ Usage threshold settlement or application failed:", err);
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
  const campaignIdentity = String(
    (userDoc as any)?.a2p?.campaignSid ||
      (userDoc as any)?.a2p?.campaignId ||
      (userDoc as any)?.twilio?.a2pCampaignSid ||
      userDoc._id,
  );
  const sourceId = `a2p_fee:${campaignIdentity}`;
  const existing = await BillingEvent.findOne({
    source: "a2p_fee",
    sourceId,
    amountCents: A2P_APPROVAL_FEE_CENTS,
  }).lean();
  if (existing && String((existing as any).status) === "applied") {
    return { charged: false, reason: "already-charged" };
  }

  // Fallback: also check Stripe customer metadata (legacy path)
  const meta = customer?.metadata || {};
  const alreadyInMeta =
    String(meta["a2p_approval_charged"] || "").toLowerCase() === "true";
  if (alreadyInMeta) return { charged: false, reason: "already-charged" };

  const event = await createFinalizePayInvoice({
    customerId: userDoc.stripeCustomerId,
    amountCents: A2P_APPROVAL_FEE_CENTS,
    description: `A2P 10DLC registration approval fee ($${A2P_APPROVAL_FEE_USD})`,
    source: "a2p_fee",
    sourceId,
    userEmail: userDoc.email as string,
    userId: String(userDoc._id),
    bucket: "a2p",
  });
  await applyPaidBillingEvent(event);

  await stripe.customers.update(userDoc.stripeCustomerId, {
    metadata: { ...meta, a2p_approval_charged: "true" },
  });

  return { charged: true };
}
