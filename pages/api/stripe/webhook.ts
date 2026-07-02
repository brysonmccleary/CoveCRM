// pages/api/stripe/webhook.ts
// STRIPE WEBHOOK EVENTS HANDLED:
// - account.updated
// - promotion_code.created
// - promotion_code.updated
// - checkout.session.completed
// - invoice.paid
// - invoice.payment_succeeded
// - credit_note.created
// - charge.refunded
// - charge.dispute.created
// - customer.subscription.trial_will_end
// - customer.subscription.updated
// - customer.subscription.deleted
// - invoice.payment_failed
// - customer.subscription.created
// - transfer.created
// - transfer.reversed
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import type { IAffiliate } from "@/models/Affiliate";
import AffiliatePayout from "@/models/AffiliatePayout";
import AffiliatePayoutLedger from "@/models/AffiliatePayoutLedger";
import User from "@/models/User";
import Folder from "@/models/Folder";
import EmailCampaign from "@/models/EmailCampaign";
import ProspectingPlan from "@/models/ProspectingPlan";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import PhoneNumber from "@/models/PhoneNumber";
import { assignLeadsToUser } from "@/lib/prospecting/assignLeads";
import { sendAffiliateApprovedEmail, sendEmail } from "@/lib/email";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { Resend } from "resend";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";
import {
  AFFILIATE_MONTHLY_CREDIT_CENTS,
  AFFILIATE_MONTHLY_CREDIT_USD,
  affiliateCreditPayableAt,
} from "@/lib/affiliate/payoutPolicy";

export const config = { api: { bodyParser: false } };

/* ──────────────────────────────────────────────────────────────────────────── */
/* small utils (kept local; no behavior change elsewhere)                      */
/* ──────────────────────────────────────────────────────────────────────────── */

const U = (s?: string | null) => (s || "").trim().toUpperCase();
const L = (s?: string | null) => (s || "").trim().toLowerCase();

const envBool = (n: string, d = false) => {
  const v = process.env[n];
  if (v == null) return d;
  return v === "1" || v.toLowerCase() === "true";
};

const ADMIN_FREE_AI_EMAILS: string[] = (process.env.ADMIN_FREE_AI_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const isAdminFree = (email?: string | null) =>
  !!email && ADMIN_FREE_AI_EMAILS.includes(L(email));

const INTERNAL_NUMBER_PURCHASE_BYPASS_EMAILS: string[] = [
  "support@covecrm.com",
  "admin@covecrm.com",
  "bryson.mccleary1@gmail.com",
  ...(process.env.INTERNAL_TWILIO_NUMBER_PURCHASE_BYPASS_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
];

const PHONE_SUBSCRIPTION_PURPOSE = "phone_number";
const DEFAULT_PHONE_PRICE_ID = "price_1TkCtfDF9aEsjVyJRrUfYdLF";
const LEGACY_PHONE_PRICE_IDS = [
  "price_1RpvR9DF9aEsjVyJk9GiJkpe",
  ...(process.env.STRIPE_LEGACY_PHONE_PRICE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];
const CONFIGURED_PHONE_PRICE_ID = String(process.env.STRIPE_PHONE_PRICE_ID || "").trim();
const PHONE_PRICE_ID =
  CONFIGURED_PHONE_PRICE_ID && !LEGACY_PHONE_PRICE_IDS.includes(CONFIGURED_PHONE_PRICE_ID)
    ? CONFIGURED_PHONE_PRICE_ID
    : DEFAULT_PHONE_PRICE_ID;

const canBypassNumberPurchaseBilling = (user: any, email?: string | null) => {
  const normalizedEmail = L(email || user?.email || "");
  return Boolean(
    user?.isOwner === true ||
      user?.role === "owner" ||
      INTERNAL_NUMBER_PURCHASE_BYPASS_EMAILS.includes(normalizedEmail),
  );
};

async function isPhoneNumberSubscription(subscriptionId?: string | null) {
  if (!subscriptionId) return { ok: false, reason: "missing_subscription_id", sub: null as Stripe.Subscription | null };

  try {
    const sub = await stripe.subscriptions.retrieve(String(subscriptionId), {
      expand: ["items.data.price"],
    });

    const metadata = sub.metadata || {};
    const purpose = String(metadata.purpose || "").trim().toLowerCase();
    const phoneBilling = String(metadata.phoneBilling || "").trim().toLowerCase();
    const hasPhonePrice = (sub.items?.data || []).some(
      (item: any) =>
        item?.price?.id === PHONE_PRICE_ID ||
        LEGACY_PHONE_PRICE_IDS.includes(String(item?.price?.id || "")),
    );

    const ok =
      purpose === PHONE_SUBSCRIPTION_PURPOSE ||
      phoneBilling === "true" ||
      (hasPhonePrice && !!metadata.phoneNumber && !!metadata.userEmail);

    return {
      ok,
      reason: ok ? "phone_subscription_confirmed" : "subscription_not_phone_specific",
      sub,
    };
  } catch (e: any) {
    return {
      ok: false,
      reason: `subscription_lookup_failed:${e?.message || String(e)}`,
      sub: null as Stripe.Subscription | null,
    };
  }
}

const currentMonthKey = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

const PLAN_PRICE_MAP: Record<string, { planCode: "base" | "ai"; billingInterval: "monthly" | "annual" }> = {
  ...(process.env.CoveCRM_Base
    ? { [process.env.CoveCRM_Base]: { planCode: "base" as const, billingInterval: "monthly" as const } }
    : {}),
  ...(process.env.CoveCRM_Annual_Base_Plan
    ? { [process.env.CoveCRM_Annual_Base_Plan]: { planCode: "base" as const, billingInterval: "annual" as const } }
    : {}),
  ...(process.env.CoveCRM_AI_Plan
    ? { [process.env.CoveCRM_AI_Plan]: { planCode: "ai" as const, billingInterval: "monthly" as const } }
    : {}),
  ...(process.env.CoveCRM_AI_Annual_Plan
    ? { [process.env.CoveCRM_AI_Annual_Plan]: { planCode: "ai" as const, billingInterval: "annual" as const } }
    : {}),
};

// House code exclusion (defaults to COVE50 if env unset)
const HOUSE_CODE = U(process.env.AFFILIATE_HOUSE_CODE || "COVE50");
const isHouseCode = (code?: string | null) => !!code && U(code) === HOUSE_CODE;

// AI Suite price id (single upgrade)
const AI_PRICE_ID = (process.env.STRIPE_PRICE_ID_AI_MONTHLY || "").trim();

// slim audit logger
const audit = (msg: string, extra?: Record<string, unknown>) => {
  try {
    // keep logs terse; no PII
    console.info(`[stripe-webhook] ${msg}`, extra || {});
  } catch {}
};

async function releasePhoneNumbersForSubscription(args: {
  subscriptionId?: string | null;
  customerId?: string | null;
  reason: "payment_failed" | "subscription_deleted";
  cancelStripeSubscription?: boolean;
}) {
  const { subscriptionId, customerId, reason, cancelStripeSubscription = false } = args;

  const phoneSubscriptionCheck = await isPhoneNumberSubscription(subscriptionId);
  if (!phoneSubscriptionCheck.ok) {
    audit(`${reason}: skip number cleanup`, {
      subscriptionId: subscriptionId || null,
      customerId: customerId || null,
      reason: phoneSubscriptionCheck.reason,
    });
    return;
  }

  const phoneSub = phoneSubscriptionCheck.sub;
  const phoneSubCustomerId =
    typeof phoneSub?.customer === "string" ? phoneSub.customer : phoneSub?.customer?.id || "";

  const userQuery: Record<string, unknown> = {
    "numbers.subscriptionId": subscriptionId,
  };
  if (customerId) {
    userQuery.stripeCustomerId = customerId;
  }

  const users = await User.find(userQuery);
  for (const user of users) {
    const number: any = (user as any).numbers?.find(
      (n: any) => n.subscriptionId === subscriptionId,
    );
    if (!number) continue;

    const normalizedEmail = L(user.email || "");
    const normalizedPhoneNumber = String(number.phoneNumber || "");
    const normalizedUserId = String((user as any)._id || "");

    if (canBypassNumberPurchaseBilling(user, user.email)) {
      audit(`${reason}: skip bypass user number release`, {
        subscriptionId,
        userId: normalizedUserId,
        email: normalizedEmail,
        phoneNumber: normalizedPhoneNumber || null,
      });
      continue;
    }

    if (customerId && String((user as any).stripeCustomerId || "") !== String(customerId)) {
      audit("number release skipped due to ownership mismatch", {
        eventReason: reason,
        subscriptionId,
        customerId,
        userId: normalizedUserId,
        email: normalizedEmail,
        phoneNumber: normalizedPhoneNumber || null,
        mismatch: "user_customer_mismatch",
      });
      continue;
    }

    if (phoneSubCustomerId && phoneSubCustomerId !== String((user as any).stripeCustomerId || "")) {
      audit("number release skipped due to ownership mismatch", {
        eventReason: reason,
        subscriptionId,
        customerId: customerId || null,
        subscriptionCustomerId: phoneSubCustomerId,
        userId: normalizedUserId,
        email: normalizedEmail,
        phoneNumber: normalizedPhoneNumber || null,
        mismatch: "subscription_customer_mismatch",
      });
      continue;
    }

    const phoneDoc = await PhoneNumber.findOne({
      phoneNumber: normalizedPhoneNumber,
    })
      .select("userId twilioSid phoneNumber")
      .lean();

    if (phoneDoc && String((phoneDoc as any).userId || "") !== normalizedUserId) {
      audit("number release skipped due to ownership mismatch", {
        eventReason: reason,
        subscriptionId,
        userId: normalizedUserId,
        email: normalizedEmail,
        phoneNumber: normalizedPhoneNumber || null,
        mismatch: "phone_doc_owner_mismatch",
      });
      continue;
    }

    if (phoneSub?.metadata?.userId && String(phoneSub.metadata.userId) !== normalizedUserId) {
      audit("number release skipped due to ownership mismatch", {
        eventReason: reason,
        subscriptionId,
        userId: normalizedUserId,
        email: normalizedEmail,
        phoneNumber: normalizedPhoneNumber || null,
        mismatch: "subscription_user_id_mismatch",
      });
      continue;
    }

    if (phoneSub?.metadata?.userEmail && L(phoneSub.metadata.userEmail) !== normalizedEmail) {
      audit(`${reason}: skip number release due to subscription email mismatch`, {
        subscriptionId,
        userId: normalizedUserId,
        email: normalizedEmail,
        subscriptionEmail: L(phoneSub.metadata.userEmail),
        phoneNumber: normalizedPhoneNumber || null,
      });
      continue;
    }

    if (
      phoneSub?.metadata?.phoneNumber &&
      String(phoneSub.metadata.phoneNumber) !== normalizedPhoneNumber
    ) {
      audit(`${reason}: skip number release due to subscription phone mismatch`, {
        subscriptionId,
        userId: normalizedUserId,
        email: normalizedEmail,
        phoneNumber: normalizedPhoneNumber || null,
        subscriptionPhoneNumber: String(phoneSub.metadata.phoneNumber),
      });
      continue;
    }

    let resolvedClient: Awaited<ReturnType<typeof getClientForUser>> | null = null;
    try {
      resolvedClient = await getClientForUser(normalizedEmail);
    } catch (e: any) {
      audit(`${reason}: skip number release due to Twilio client resolution failure`, {
        subscriptionId,
        userId: normalizedUserId,
        email: normalizedEmail,
        phoneNumber: normalizedPhoneNumber || null,
        reason: e?.message || String(e),
      });
      continue;
    }

    const candidateSid =
      String((phoneDoc as any)?.twilioSid || number.sid || "").trim() || undefined;
    if (!candidateSid && !normalizedPhoneNumber) {
      audit(`${reason}: skip number release due to missing number identity`, {
        subscriptionId,
        userId: normalizedUserId,
        email: normalizedEmail,
      });
      continue;
    }

    try {
      if (candidateSid) {
        await (resolvedClient.client as any).incomingPhoneNumbers(candidateSid).remove();
      } else {
        const matches = await resolvedClient.client.incomingPhoneNumbers.list({
          phoneNumber: normalizedPhoneNumber,
          limit: 1,
        });
        if (!matches.length) {
          throw new Error("number_not_found_in_tenant_twilio");
        }
        await (resolvedClient.client as any)
          .incomingPhoneNumbers(matches[0].sid)
          .remove();
      }
    } catch (e: any) {
      audit("number release failed in Twilio", {
        eventReason: reason,
        subscriptionId,
        userId: normalizedUserId,
        email: normalizedEmail,
        phoneNumber: normalizedPhoneNumber || null,
        reason: e?.message || String(e),
      });
      continue;
    }

    if (cancelStripeSubscription && subscriptionId) {
      try {
        await stripe.subscriptions.cancel(subscriptionId);
      } catch {}
    }

    (user as any).numbers = (user as any).numbers.filter(
      (n: any) => n.subscriptionId !== subscriptionId,
    );
    await user.save();

    await PhoneNumber.deleteOne({
      phoneNumber: normalizedPhoneNumber,
      userId: (user as any)._id,
    });

    audit(`number released due to ${reason}`, {
      subscriptionId,
      userId: normalizedUserId,
      email: normalizedEmail,
      phoneNumber: normalizedPhoneNumber || null,
    });
  }
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Affiliate helpers (existing behavior preserved; targeted adjustments only)   */
/* ──────────────────────────────────────────────────────────────────────────── */

async function upsertAffiliateFromPromo(
  pc: Stripe.PromotionCode,
): Promise<IAffiliate | null> {
  const code = U(pc.code);
  if (!code) return null;
  const couponId =
    typeof pc.coupon === "string" ? pc.coupon : pc.coupon?.id || undefined;

  const aff = await Affiliate.findOneAndUpdate(
    { promoCode: code },
    {
      $set: {
        promoCode: code,
        promotionCodeId: pc.id,
        couponId,
        approved: !!pc.active,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { new: true, upsert: true },
  ).lean<IAffiliate | null>();

  return aff;
}

async function findAffiliateByPromoCode(
  code: string,
): Promise<IAffiliate | null> {
  const q = U(code);
  if (!q) return null;
  return Affiliate.findOne({ promoCode: q }).lean<IAffiliate | null>();
}

async function markRedemptionOnce(affId: string, sessionId: string) {
  const aff = await Affiliate.findById(affId);
  if (!aff) return;

  const already = (aff.payoutHistory || []).some(
    (p: any) => p?.note === `redemption:session:${sessionId}`,
  );
  if (already) return;

  aff.totalRedemptions = Number(aff.totalRedemptions || 0) + 1;
  aff.payoutHistory = [
    ...(aff.payoutHistory || []),
    {
      amount: 0,
      userEmail: "",
      date: new Date(),
      invoiceId: null,
      subscriptionId: null,
      customerId: null,
      note: `redemption:session:${sessionId}`,
    } as any,
  ];
  await aff.save();
}

interface CreditOnceOpts {
  affiliate: IAffiliate & { [k: string]: any };
  invoiceId: string;
  subscriptionId?: string | null;
  customerId?: string | null;
  userEmail?: string | null;
  amountUSD?: number;
  isFirstInvoice?: boolean;
  note?: string;
}
async function creditAffiliateOnce(opts: CreditOnceOpts) {
  audit("legacy flat affiliate credit skipped", {
    affiliateId: String((opts.affiliate as any)?._id || ""),
    invoiceId: opts.invoiceId,
  });
  return false;
}

async function maybeAutoPayout(affiliateInput: IAffiliate, invoiceId: string) {
  audit("legacy affiliate autopayout skipped", {
    affiliateId: String((affiliateInput as any)?._id || ""),
    invoiceId,
  });
}

async function affiliateOwnerActive(affiliate: any) {
  const ownerId = affiliate?.userId;
  if (!ownerId) {
    return { active: false, reason: "missing_affiliate_userId" };
  }

  const owner = await User.findById(ownerId)
    .select({ subscriptionStatus: 1, billingBlocked: 1, email: 1 })
    .lean();

  if (!owner) return { active: false, reason: "affiliate_owner_not_found" };
  if ((owner as any).subscriptionStatus !== "active") {
    return { active: false, reason: "affiliate_owner_subscription_not_active" };
  }
  if ((owner as any).billingBlocked === true) {
    return { active: false, reason: "affiliate_owner_billing_blocked" };
  }
  return { active: true, reason: "active" };
}

async function createHeldAffiliateCreditForPaidInvoice(args: {
  user: any;
  invoiceId: string;
  subscriptionId?: string | null;
  customerId?: string | null;
  paidCents: number;
}) {
  const { user, invoiceId, subscriptionId, customerId, paidCents } = args;
  if (!user?._id || !user?.affiliateId || !invoiceId || paidCents <= 0) {
    return false;
  }

  const affiliate = await Affiliate.findById(user.affiliateId);
  if (!affiliate || affiliate.approved !== true) return false;

  const affiliateId = String((affiliate as any)._id);
  const userId = String(user._id);
  const affiliateEmail = L((affiliate as any).email);
  const userEmail = L((user as any).email);
  const affiliateOwnerId = String((affiliate as any).userId || "");

  if (
    affiliateEmail === userEmail ||
    (affiliateOwnerId && affiliateOwnerId === userId)
  ) {
    audit("affiliate credit skipped: self-referral", {
      affiliateId,
      userId,
      invoiceId,
    });
    return false;
  }

  const active = await affiliateOwnerActive(affiliate);
  if (!active.active) {
    audit("affiliate credit skipped: affiliate inactive", {
      affiliateId,
      userId,
      invoiceId,
      reason: active.reason,
    });
    return false;
  }

  const month = currentMonthKey();
  const idempotencyKey = `${affiliateId}:${invoiceId}`;

  const existing = await AffiliatePayoutLedger.findOne({ idempotencyKey });
  if (existing) return false;

  const earnedAt = new Date();
  const payableAt = affiliateCreditPayableAt(earnedAt);

  try {
    await AffiliatePayoutLedger.create({
      affiliateId: (affiliate as any)._id,
      userId: user._id,
      month,
      amount: AFFILIATE_MONTHLY_CREDIT_USD,
      amountCents: AFFILIATE_MONTHLY_CREDIT_CENTS,
      stripeInvoiceId: invoiceId,
      stripeSubscriptionId: subscriptionId || null,
      stripeCustomerId: customerId || null,
      referredUserEmail: userEmail || null,
      earnedAt,
      payableAt,
      status: "held",
      idempotencyKey,
    });

    await Affiliate.updateOne(
      { _id: (affiliate as any)._id },
      {
        $set: {
          totalRevenueGenerated:
            Number((affiliate as any).totalRevenueGenerated || 0) +
            paidCents / 100,
        },
        $addToSet: {
          referrals: {
            email: userEmail,
            joinedAt: (user as any).createdAt || new Date(),
          },
          referredUsers: {
            userId: user._id,
            joinedAt: (user as any).createdAt || new Date(),
            planCode: user.planCode || "",
            billingInterval: user.billingInterval || "",
            isActive: true,
            lastPayoutAt: null,
            totalPayoutsSentToAffiliate: 0,
          },
        },
      },
    );
    audit("affiliate held credit created", {
      affiliateId,
      userId,
      invoiceId,
      amountCents: AFFILIATE_MONTHLY_CREDIT_CENTS,
      payableAt: payableAt.toISOString(),
    });
    return true;
  } catch (e: any) {
    if (e?.code === 11000) return false;
    audit("affiliate held credit create failed", {
      affiliateId,
      userId,
      invoiceId,
      message: e?.message || String(e),
    });
    return false;
  }
}

async function resolveInvoiceIdFromCharge(
  chargeOrId?: Stripe.Charge | string | null,
): Promise<string | null> {
  if (!chargeOrId) return null;

  let charge: Stripe.Charge | null = null;
  if (typeof chargeOrId === "string") {
    try {
      charge = await stripe.charges.retrieve(chargeOrId);
    } catch (e: any) {
      audit("affiliate clawback charge retrieve failed", {
        chargeId: chargeOrId,
        message: e?.message || String(e),
      });
      return null;
    }
  } else {
    charge = chargeOrId;
  }

  const invoice = (charge as any)?.invoice;
  if (!invoice) return null;
  return typeof invoice === "string" ? invoice : String(invoice.id || "") || null;
}

async function reverseAffiliateCreditForInvoice(args: {
  invoiceId: string;
  reason: "charge.refunded" | "charge.dispute.created";
  stripeObjectId: string;
  chargeId?: string | null;
  amountRefundedCents?: number | null;
  partialRefund?: boolean;
}): Promise<void> {
  const {
    invoiceId,
    reason,
    stripeObjectId,
    chargeId,
    amountRefundedCents,
    partialRefund,
  } = args;

  const credit = await AffiliatePayoutLedger.findOne({ stripeInvoiceId: invoiceId });
  if (!credit) {
    audit("affiliate clawback skipped: no ledger credit", {
      invoiceId,
      reason,
      stripeObjectId,
      chargeId,
    });
    return;
  }

  const status = String((credit as any).status || "");
  const reversalReason = [
    reason,
    stripeObjectId,
    partialRefund ? "partial_refund_voids_flat_credit" : null,
  ]
    .filter(Boolean)
    .join(":");

  if (status === "held" || status === "processing") {
    (credit as any).status = "reversed";
    (credit as any).reversedAt = new Date();
    (credit as any).reversalReason = reversalReason;
    await credit.save();
    audit("affiliate credit reversed for clawback", {
      ledgerId: String((credit as any)._id),
      affiliateId: String((credit as any).affiliateId),
      userId: String((credit as any).userId),
      invoiceId,
      reason,
      stripeObjectId,
      amountRefundedCents,
      partialRefund: !!partialRefund,
    });
    return;
  }

  if (status === "paid") {
    (credit as any).status = "clawback_owed";
    (credit as any).reversedAt = new Date();
    (credit as any).reversalReason = reversalReason;
    await credit.save();
    const details = {
      ledgerId: String((credit as any)._id),
      affiliateId: String((credit as any).affiliateId),
      userId: String((credit as any).userId),
      invoiceId,
      reason,
      stripeObjectId,
      chargeId,
      amountRefundedCents,
      partialRefund: !!partialRefund,
    };
    console.error("[affiliate-clawback] PAID affiliate credit needs recovery", details);
    audit("affiliate credit marked clawback_owed", details);
    return;
  }

  audit("affiliate clawback skipped: credit not reversible", {
    ledgerId: String((credit as any)._id),
    affiliateId: String((credit as any).affiliateId),
    userId: String((credit as any).userId),
    invoiceId,
    status,
    reason,
    stripeObjectId,
    chargeId,
  });
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* AI entitlement helper: compute hasAI across ALL active subs for customer     */
/* ──────────────────────────────────────────────────────────────────────────── */

async function computeHasAIForCustomer(customerId: string): Promise<boolean> {
  if (!customerId || !AI_PRICE_ID) return false;

  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      expand: ["data.items.data.price"],
      limit: 100,
    });

    for (const sub of subs.data as Stripe.Subscription[]) {
      const activeLike = sub.status === "active" || sub.status === "trialing";
      if (!activeLike) continue;

      const items = sub.items?.data || [];
      const hasAiOnThisSub = items.some((it: any) => it?.price?.id === AI_PRICE_ID);
      if (hasAiOnThisSub) return true;
    }

    return false;
  } catch (e: any) {
    audit("computeHasAIForCustomer failed", {
      customerId,
      message: e?.message || String(e),
    });
    return false;
  }
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Webhook handler                                                             */
/* ──────────────────────────────────────────────────────────────────────────── */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const sig = req.headers["stripe-signature"] as string | undefined;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig) return res.status(400).send("Missing stripe-signature");
  if (!secret) return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");

  let event: Stripe.Event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(buf, sig, secret);
  } catch (err: any) {
    console.error("❌ Invalid Stripe webhook signature:", err?.message || err);
    return res.status(400).send("Invalid signature");
  }

  try {
    await dbConnect();
  } catch (e) {
    console.error("dbConnect failed:", e);
  }

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        let connectedAccountStatus:
          | "pending"
          | "incomplete"
          | "restricted"
          | "verified" = "pending";
        if (account.requirements?.currently_due?.length)
          connectedAccountStatus = "incomplete";
        if (account.requirements?.disabled_reason)
          connectedAccountStatus = "restricted";
        if (
          account.charges_enabled &&
          account.payouts_enabled &&
          account.details_submitted
        ) {
          connectedAccountStatus = "verified";
        }
        const onboardingCompleted =
          !!account.details_submitted &&
          !!account.charges_enabled &&
          !!account.payouts_enabled;

        await Affiliate.findOneAndUpdate(
          { stripeConnectId: account.id },
          { connectedAccountStatus, onboardingCompleted },
          { new: true },
        );
        break;
      }

      case "promotion_code.created":
      case "promotion_code.updated": {
        const promo = event.data.object as Stripe.PromotionCode;

        const before = await Affiliate.findOne({
          promoCode: U(promo.code),
        }).lean<IAffiliate | null>();

        const aff = await upsertAffiliateFromPromo(promo);

        if (!before?.approved && !!aff?.approved) {
          try {
            const url =
              process.env.NEXTAUTH_URL &&
              `${process.env.NEXTAUTH_URL}${
                process.env.AFFILIATE_RETURN_PATH || "/dashboard?tab=settings"
              }`;
            await sendAffiliateApprovedEmail({
              to: aff.email,
              name: aff.name,
              code: U(promo.code),
              promoCode: U(promo.code),
              dashboardUrl: url || undefined,
            });
          } catch (e) {
            console.warn("sendAffiliateApprovedEmail failed:", e);
          }
        }
        break;
      }

      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;

        const emailRaw =
          s.customer_email ||
          (s.customer_details?.email as string | undefined) ||
          "";
        const email = emailRaw ? L(emailRaw) : "";

        const purpose = s.metadata?.purpose || "";

        /* ───────────── AI DIALER TOP-UP (manual or auto-triggered checkout) ───────────── */
        if (purpose === "ai_dialer_topup") {
          if (!email) {
            audit("ai_dialer_topup: missing email on session", {
              sessionId: s.id,
            });
            break;
          }

          const user = await User.findOne({ email });
          if (!user) {
            audit("ai_dialer_topup: user not found", {
              email,
              sessionId: s.id,
            });
            break;
          }

          const amountUSD =
            typeof s.amount_total === "number" ? s.amount_total / 100 : 0;

          if (!amountUSD || amountUSD <= 0) {
            audit("ai_dialer_topup: zero or missing amount", {
              email,
              sessionId: s.id,
              amountUSD,
            });
            break;
          }

          const currentBalance = Number((user as any).aiDialerBalance || 0);
          (user as any).aiDialerBalance = currentBalance + amountUSD;
          (user as any).aiDialerLastTopUpAt = new Date();

          await user.save();

          audit("ai_dialer_topup: credited", {
            email,
            sessionId: s.id,
            addedUSD: amountUSD,
            newBalanceUSD: (user as any).aiDialerBalance,
          });

          break;
        }

        /* ───────────── AI SUITE UPGRADE (single entitlement; NO FREE MINUTES) ─────────────
           Back-compat: treat legacy ai_dialer_access the same as ai_suite
        */
        if (purpose === "ai_suite" || purpose === "ai_dialer_access") {
          if (!email) {
            audit("ai_suite: missing email on session", { sessionId: s.id });
            break;
          }

          const userIdMeta = s.metadata?.userId;
          let user: any = null;

          if (userIdMeta) user = await User.findById(userIdMeta);
          if (!user) user = await User.findOne({ email });

          if (!user) {
            audit("ai_suite: user not found", { email, sessionId: s.id });
            break;
          }

          // Store Stripe customer if not already present
          if (
            !user.stripeCustomerId &&
            typeof s.customer === "string" &&
            s.customer
          ) {
            user.stripeCustomerId = s.customer;
          }

          // ✅ One upgrade: enable AI features
          user.hasAI = true;

          // ✅ IMPORTANT: Do NOT grant any initial dialer credit here.
          // ✅ Also: DO NOT “arm” auto-reload yet — that should only happen on first dialer use.
          if (typeof (user as any).aiDialerAutoReloadArmed !== "boolean") {
            (user as any).aiDialerAutoReloadArmed = false;
          }

          await user.save();

          audit("ai_suite: enabled (no initial credit)", {
            email,
            sessionId: s.id,
            customerId: s.customer,
          });

          break;
        }

        /* ───────────── FB Lead Manager Purchase ───────────── */
        if (purpose === "fb_lead_manager" || purpose === "fb_lead_manager_pro") {
          if (!email) {
            audit("fb_lead_manager: missing email", { sessionId: s.id });
            break;
          }

          const planTier = purpose === "fb_lead_manager_pro" ? "manager_pro" : "manager";
          const userIdMeta = s.metadata?.userId;
          let fbUser: any = null;
          if (userIdMeta) fbUser = await User.findById(userIdMeta);
          if (!fbUser) fbUser = await User.findOne({ email });
          if (!fbUser) {
            audit("fb_lead_manager: user not found", { email, sessionId: s.id });
            break;
          }

          const periodEnd = new Date();
          periodEnd.setDate(periodEnd.getDate() + 30);
          const subscriptionId = (s.subscription as string) || "";

          await FBLeadSubscription.findOneAndUpdate(
            { userEmail: email },
            {
              $set: {
                userId: fbUser._id,
                userEmail: email,
                plan: planTier,
                status: "active",
                stripeSubscriptionId: subscriptionId || undefined,
                currentPeriodEnd: periodEnd,
              },
            },
            { upsert: true, new: true }
          );

          try {
            const resendClient = new Resend(process.env.RESEND_API_KEY);
            await resendClient.emails.send({
              from: process.env.EMAIL_FROM || "noreply@covecrm.com",
              to: email,
              subject: "Your Facebook Lead Manager is now active",
              html: `<p>Hi ${fbUser.name || "there"},</p><p>Your CoveCRM Facebook Lead Manager subscription is active. Your leads will now flow directly into CoveCRM automatically.</p><p><a href="${process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com"}/facebook-leads">Log in to complete your campaign setup →</a></p><p>— The CoveCRM Team</p>`,
            });
          } catch (mailErr) {
            audit("fb_lead_manager: confirmation email failed", {
              email,
              error: (mailErr as any)?.message,
            });
          }

          audit("fb_lead_manager: provisioned", {
            email,
            plan: planTier,
            sessionId: s.id,
          });

          break;
        }

        /* ───────────── Prospecting Plan Purchase ───────────── */
        if (purpose === "prospecting_plan") {
          if (!email) {
            audit("prospecting_plan: missing email", { sessionId: s.id });
            break;
          }

          const userIdMeta = s.metadata?.userId;
          let prospUser: any = null;
          if (userIdMeta) prospUser = await User.findById(userIdMeta);
          if (!prospUser) prospUser = await User.findOne({ email });
          if (!prospUser) {
            audit("prospecting_plan: user not found", { email, sessionId: s.id });
            break;
          }

          const tierRaw = parseInt(s.metadata?.planTier || "250", 10);
          const planTier = [250, 500, 1000, 2500].includes(tierRaw)
            ? (tierRaw as 250 | 500 | 1000 | 2500)
            : 250;
          const subscriptionId = (s.subscription as string) || "";
          const stripeProductId = s.metadata?.stripeProductId || "";

          // Idempotency — skip if plan already created for this subscription
          const existingPlan = subscriptionId
            ? await ProspectingPlan.findOne({ stripeSubscriptionId: subscriptionId }).lean()
            : null;

          if (existingPlan) {
            audit("prospecting_plan: already provisioned", {
              sessionId: s.id,
              subscriptionId,
            });
            break;
          }

          const periodStart = new Date();
          const periodEnd = new Date();
          periodEnd.setMonth(periodEnd.getMonth() + 1);

          const plan = await ProspectingPlan.create({
            userId: prospUser._id,
            userEmail: email,
            planTier,
            leadsIncluded: planTier,
            leadsAssigned: 0,
            leadsRemaining: planTier,
            periodStart,
            periodEnd,
            status: "active",
            stripeSubscriptionId: subscriptionId || undefined,
            stripeProductId: stripeProductId || undefined,
            autoRenew: !!subscriptionId,
            autoFulfill: true,
          });

          // Create default Prospecting Folder
          const monthYear = periodStart.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          });
          const folderName = `Prospecting Leads — ${monthYear}`;

          const folder = await Folder.findOneAndUpdate(
            { userEmail: email, name: folderName },
            { $setOnInsert: { userEmail: email, name: folderName, assignedDrips: [] } },
            { upsert: true, new: true }
          );

          // Find or create a default email campaign for this user
          let campaign = await EmailCampaign.findOne({
            userEmail: email,
            isActive: true,
          }).lean();

          if (!campaign) {
            const baseUrl =
              process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com";

            campaign = await EmailCampaign.create({
              userId: prospUser._id,
              userEmail: email,
              name: "Prospecting Outreach",
              isActive: true,
              fromName: prospUser.name || "",
              fromEmail: email,
              dailyLimit: 100,
              steps: [
                {
                  day: 0,
                  subject: "A quick note from {{agentName}}",
                  html: `<p>Hi {{firstName}},</p><p>My name is ${prospUser.name || "a fellow agent"} and I wanted to reach out. I specialize in helping insurance professionals like yourself get better results for their clients.</p><p>Would you be open to a quick conversation?</p><p>— ${prospUser.name || "Your Name"}</p>`,
                  text: "",
                },
                {
                  day: 3,
                  subject: "Following up",
                  html: `<p>Hi {{firstName}},</p><p>Just wanted to follow up on my previous note. I'd love to connect when you have a moment.</p><p>— ${prospUser.name || "Your Name"}</p>`,
                  text: "",
                },
                {
                  day: 7,
                  subject: "Last note",
                  html: `<p>Hi {{firstName}},</p><p>I'll keep this brief — if there's ever a time you'd like to connect, I'm here.</p><p>— ${prospUser.name || "Your Name"}</p>`,
                  text: "",
                },
              ],
            });
          }

          // Persist folder/campaign references for automation
          await ProspectingPlan.updateOne(
            { _id: plan._id },
            { $set: { folderId: folder._id, campaignId: (campaign as any)._id } }
          );

          // Assign leads
          const assignResult = await assignLeadsToUser(
            prospUser._id,
            email,
            planTier,
            plan._id,
            folder._id as any,
            (campaign as any)._id
          ).catch((e: any) => {
            audit("prospecting_plan: assignLeads error", { error: e?.message });
            return { assigned: 0, leads: [], errors: [e?.message] };
          });

          const intervalDays =
            Number(process.env.PROSPECTING_PLAN_FULFILLMENT_DAYS || "30") || 30;
          const retryHours =
            Number(process.env.PROSPECTING_PLAN_RETRY_HOURS || "6") || 6;
          const nextFulfillmentAt = new Date();
          if (assignResult.assigned) {
            nextFulfillmentAt.setDate(nextFulfillmentAt.getDate() + intervalDays);
            nextFulfillmentAt.setHours(9, 0, 0, 0);
          } else {
            nextFulfillmentAt.setHours(nextFulfillmentAt.getHours() + retryHours);
          }
          await ProspectingPlan.updateOne(
            { _id: plan._id },
            {
              $set: {
                lastFulfilledAt: new Date(),
                nextFulfillmentAt,
              },
            }
          );

          audit("prospecting_plan: provisioned", {
            userId: String(prospUser._id),
            planTier,
            assigned: assignResult.assigned,
            sessionId: s.id,
          });

          // Send confirmation email via Resend
          try {
            const resendClient = new Resend(process.env.RESEND_API_KEY);
            const baseUrl =
              process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com";
            await resendClient.emails.send({
              from:
                process.env.EMAIL_FROM || "noreply@covecrm.com",
              to: email,
              subject: `Your ${planTier} prospecting leads are ready!`,
              html: `
                <p>Hi ${prospUser.name || "there"},</p>
                <p>Your CoveCRM Prospecting Plan (${planTier} leads) has been activated.</p>
                <p><strong>${assignResult.assigned} leads</strong> have been added to your CRM folder <em>${folderName}</em> and enrolled in your email campaign.</p>
                <p><a href="${baseUrl}/dashboard">Log in to view your leads →</a></p>
                <p>— The CoveCRM Team</p>
              `,
            });
          } catch (mailErr) {
            audit("prospecting_plan: confirmation email failed", {
              email,
              error: (mailErr as any)?.message,
            });
          }

          break;
        }

        /* ───────────── Normal CRM subscription checkout ───────────── */
        const userId = s.metadata?.userId;
        const referralCodeUsed = U(s.metadata?.referralCodeUsed || "");

        if (!email || !userId) break;
        const user = await User.findById(userId);
        if (!user) break;

        (user as any).isProUser = true;

        const upgradeIncluded =
          (s.metadata?.upgradeIncluded || "false").toLowerCase() === "true";
        user.hasAI = isAdminFree(email) ? true : upgradeIncluded;

        user.plan = "Pro";
        user.stripeCustomerId =
          (s.customer as string) || user.stripeCustomerId || "";
        (user as any).subscribedAt = new Date();
        user.subscriptionStatus = "active";
        if (referralCodeUsed) (user as any).referredBy = referralCodeUsed;
        await user.save();

        if (referralCodeUsed) {
          try {
            const list = await stripe.promotionCodes.list({
              code: referralCodeUsed,
              limit: 1,
            });
            const pc = list.data[0];
            if (pc) {
              const aff = await upsertAffiliateFromPromo(pc);
              if (aff && s.id)
                await markRedemptionOnce(String((aff as any)._id), s.id);
            }
          } catch {}
        }

        audit("checkout.session.completed", {
          userId,
          customerId: s.customer,
          referral: referralCodeUsed || null,
        });
        break;
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = inv.customer as string | undefined;
        const paidCents = Number(inv.amount_paid || 0);

        let subscriptionId: string | null =
          (inv.subscription as string) || null;

        let affiliateCreditCreated = false;
        if (customerId) {
          const user = await User.findOne({ stripeCustomerId: customerId });
          if (user) {
            user.subscriptionStatus = "active";
            // Only mark hasEverPaid when real money was collected.
            // $0 trial invoices and 100%-off promo invoices must NOT set this flag,
            // because the customer may have no card stored yet.
            if (paidCents > 0) {
              (user as any).hasEverPaid = true;
              (user as any).billingBlocked = false;
              (user as any).billingBlockedReason = null;
            }
            (user as any).pastDueSince = null;
            (user as any).callingBlocked = false;
            await user.save();
            if (paidCents > 0) {
              affiliateCreditCreated = await createHeldAffiliateCreditForPaidInvoice({
                user,
                invoiceId: String(inv.id || ""),
                subscriptionId,
                customerId: customerId || null,
                paidCents,
              });
            }
          }
        }

        audit("invoice.payment_succeeded processed", {
          invoiceId: inv.id,
          subscriptionId,
          customerId,
          affiliateCreditCreated,
        });
        break;
      }

      case "credit_note.created": {
        const note = event.data.object as Stripe.CreditNote;
        const invoiceId = (note.invoice as string) || "";
        if (!invoiceId) break;

        audit("credit_note affiliate payoutDue reversal skipped", {
          invoiceId,
          creditNoteId: note.id,
          reason: "ledger refund/dispute reversal handled in clawback stage",
        });
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const invoiceId = await resolveInvoiceIdFromCharge(charge);
        if (!invoiceId) {
          audit("affiliate clawback skipped: refund charge has no invoice", {
            chargeId: charge.id,
            amountRefundedCents: Number(charge.amount_refunded || 0),
          });
          break;
        }

        const amountRefundedCents = Number(charge.amount_refunded || 0);
        const chargeAmountCents = Number(charge.amount || 0);
        await reverseAffiliateCreditForInvoice({
          invoiceId,
          reason: "charge.refunded",
          stripeObjectId: charge.id,
          chargeId: charge.id,
          amountRefundedCents,
          partialRefund:
            amountRefundedCents > 0 &&
            chargeAmountCents > 0 &&
            amountRefundedCents < chargeAmountCents,
        });
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeRef = (dispute as any).charge as Stripe.Charge | string | null;
        const invoiceId = await resolveInvoiceIdFromCharge(chargeRef);
        if (!invoiceId) {
          audit("affiliate clawback skipped: dispute charge has no invoice", {
            disputeId: dispute.id,
            chargeId:
              typeof chargeRef === "string"
                ? chargeRef
                : chargeRef?.id || null,
          });
          break;
        }

        await reverseAffiliateCreditForInvoice({
          invoiceId,
          reason: "charge.dispute.created",
          stripeObjectId: dispute.id,
          chargeId:
            typeof chargeRef === "string"
              ? chargeRef
              : chargeRef?.id || null,
        });
        break;
      }

      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user && (user as any).cardOnFile === false) {
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com";
          const billingUrl = `${baseUrl.replace(/\/$/, "")}/settings?tab=billing`;
          await sendEmail(
            user.email,
            "Your CoveCRM trial ends in 3 days",
            `<p>Your CoveCRM trial ends in 3 days.</p><p>Add a payment method to keep access: <a href="${billingUrl}">${billingUrl}</a></p>`,
          );
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        const activeLike =
          sub.status === "active" || sub.status === "trialing";

        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.subscriptionStatus = activeLike ? "active" : "canceled";

          // ✅ CRITICAL: recompute AI entitlement across ALL active subs
          const computedHasAI = await computeHasAIForCustomer(customerId);
          user.hasAI = isAdminFree(user.email) ? true : computedHasAI;

          // Ensure flag exists (do not arm it here)
          if (typeof (user as any).aiDialerAutoReloadArmed !== "boolean") {
            (user as any).aiDialerAutoReloadArmed = false;
          }

          const firstPrice = sub.items?.data?.[0]?.price as Stripe.Price | undefined;
          const firstPriceId = firstPrice?.id || "";
          const mappedPlan = firstPriceId ? PLAN_PRICE_MAP[firstPriceId] : null;
          if (firstPriceId) (user as any).stripePriceId = firstPriceId;
          if (firstPrice?.recurring?.interval === "month") {
            (user as any).billingInterval = "monthly";
          } else if (firstPrice?.recurring?.interval === "year") {
            (user as any).billingInterval = "annual";
          } else if (mappedPlan?.billingInterval) {
            (user as any).billingInterval = mappedPlan.billingInterval;
          }
          if (mappedPlan?.planCode) {
            (user as any).planCode = mappedPlan.planCode;
            user.hasAI = isAdminFree(user.email) ? true : mappedPlan.planCode === "ai";
            (user as any).aiEntitlementSource = mappedPlan.planCode === "ai" ? "plan" : "none";
          }

          await user.save();
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.subscriptionStatus = "canceled";

          // ✅ If they still have an active AI sub, keep hasAI true.
          const computedHasAI = await computeHasAIForCustomer(customerId);
          user.hasAI = isAdminFree(user.email) ? true : computedHasAI;

          if (typeof (user as any).aiDialerAutoReloadArmed !== "boolean") {
            (user as any).aiDialerAutoReloadArmed = false;
          }

          try {
            const activeSubs = await stripe.subscriptions.list({
              customer: customerId,
              status: "all",
              limit: 20,
            });
            const hasOtherActive = activeSubs.data.some(
              (activeSub) =>
                activeSub.id !== sub.id &&
                ["active", "trialing", "past_due", "incomplete"].includes(activeSub.status),
            );
            if (!hasOtherActive) {
              (user as any).cardOnFile = false;
            }
          } catch (e: any) {
            audit("subscription.deleted active subscription check failed", {
              customerId,
              message: e?.message || String(e),
            });
          }

          await user.save();

          if ((user as any).affiliateId) {
            await AffiliatePayoutLedger.updateMany(
              { userId: (user as any)._id, status: "pending" },
              { $set: { status: "failed" } },
            );
            await Affiliate.updateOne(
              { _id: (user as any).affiliateId, "referredUsers.userId": (user as any)._id },
              { $set: { "referredUsers.$.isActive": false } },
            );
          }
        }

        // Cancel FB Lead Manager subscription if matched
        if (sub.id) {
          const cancelled = await FBLeadSubscription.findOneAndUpdate(
            { stripeSubscriptionId: sub.id },
            { $set: { status: "cancelled" } }
          );
          if (cancelled) {
            audit("fb_lead_manager: subscription cancelled", {
              stripeSubscriptionId: sub.id,
              userEmail: (cancelled as any).userEmail,
            });
          }
        }

        try {
          await releasePhoneNumbersForSubscription({
            subscriptionId: sub.id,
            customerId,
            reason: "subscription_deleted",
            cancelStripeSubscription: false,
          });
        } catch (e) {
          console.error("customer.subscription.deleted phone cleanup error:", e);
        }

        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subscriptionId = inv.subscription as string;
        const customerId = inv.customer as string | undefined;

        try {
          await releasePhoneNumbersForSubscription({
            subscriptionId,
            customerId: customerId || null,
            reason: "payment_failed",
            cancelStripeSubscription: false,
          });
        } catch (e) {
          console.error("invoice.payment_failed cleanup error:", e);
        }

        // Enforce calling block on the CRM platform subscription payment failure.
        // Self-billed users are excluded (they manage their own Twilio).
        if (customerId) {
          try {
            const failedUser = await User.findOne({ stripeCustomerId: customerId });
            if (failedUser && (failedUser as any).billingMode !== "self") {
              if (!(failedUser as any).hasEverPaid) {
                // Never paid — block calling immediately
                (failedUser as any).callingBlocked = true;
              } else if (!(failedUser as any).pastDueSince) {
                // Paid before — start grace period clock; do not block yet
                (failedUser as any).pastDueSince = new Date();
              }
              await failedUser.save();
              if ((failedUser as any).affiliateId) {
                audit("invoice.payment_failed: affiliate payout skipped", {
                  userId: String((failedUser as any)._id),
                  affiliateId: String((failedUser as any).affiliateId),
                  month: currentMonthKey(),
                });
              }
            }
          } catch (e) {
            console.error("invoice.payment_failed calling-block error:", e);
          }
        }

        break;
      }

      case "customer.subscription.created": {
        // Idempotency guard: if checkout.session.completed already handled a
        // prospecting_plan for this subscription, skip. This fires after checkout.
        const newSub = event.data.object as Stripe.Subscription;
        const newSubMeta = newSub.metadata || {};
        const newSubPurpose = newSubMeta.purpose || "";

        if (newSubPurpose === "prospecting_plan") {
          const alreadyProvisioned = await ProspectingPlan.findOne({
            stripeSubscriptionId: newSub.id,
          }).lean();
          if (!alreadyProvisioned) {
            // checkout.session.completed didn't fire yet — let it handle it
            audit("customer.subscription.created: prospecting_plan pending checkout", {
              subscriptionId: newSub.id,
            });
          } else {
            audit("customer.subscription.created: prospecting_plan already provisioned", {
              subscriptionId: newSub.id,
            });
          }
        }
        break;
      }

      case "transfer.created": {
        const t = event.data.object as Stripe.Transfer;
        await AffiliatePayout.updateOne(
          { stripeTransferId: t.id },
          { $set: { status: "sent" } },
        );
        break;
      }
      case "transfer.reversed": {
        const t = event.data.object as Stripe.Transfer;
        await AffiliatePayout.updateOne(
          { stripeTransferId: t.id },
          { $set: { status: "failed" } },
        );
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("Webhook handler error:", err?.message || err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}
