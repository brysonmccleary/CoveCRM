import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayout from "@/models/AffiliatePayout";
import User from "@/models/User";
import twilioClient from "@/lib/twilioClient";
import { sendAffiliateApprovedEmail } from "@/lib/email";

export const config = { api: { bodyParser: false } };

const U = (s?: string | null) => (s || "").trim().toUpperCase();
const envBool = (n: string, d = false) => {
  const v = process.env[n];
  if (v == null) return d;
  return v === "1" || v.toLowerCase() === "true";
};
const ADMIN_FREE_AI_EMAILS: string[] = (process.env.ADMIN_FREE_AI_EMAILS || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const isAdminFree = (email?: string | null) => !!email && ADMIN_FREE_AI_EMAILS.includes(email.toLowerCase());
const toCents = (usd: number) => Math.round(Number(usd || 0) * 100);

/** Upsert an Affiliate document from a Stripe PromotionCode */
async function upsertAffiliateFromPromo(pc: Stripe.PromotionCode) {
  const code = U(pc.code);
  if (!code) return null;
  const couponId = typeof pc.coupon === "string" ? pc.coupon : pc.coupon?.id;
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
  );
  return aff;
}

async function findAffiliateByPromoCode(code: string) {
  const q = U(code);
  if (!q) return null;
  return Affiliate.findOne({ promoCode: q });
}

interface CreditOnceOpts {
  affiliate: any;
  invoiceId: string;
  subscriptionId?: string | null;
  customerId?: string | null;
  userEmail?: string | null;
  amountUSD: number;
  isFirstInvoice: boolean;
  note?: string;
}
async function creditAffiliateOnce(opts: CreditOnceOpts) {
  const { affiliate, invoiceId, subscriptionId, customerId, userEmail, amountUSD, isFirstInvoice, note } = opts;

  affiliate.payoutHistory = affiliate.payoutHistory || [];

  if (affiliate.payoutHistory.some((p: any) => p?.invoiceId === invoiceId)) return false;
  if (isFirstInvoice && userEmail) {
    if (affiliate.payoutHistory.some((p: any) => p?.userEmail?.toLowerCase() === userEmail.toLowerCase())) {
      return false;
    }
  }

  affiliate.payoutHistory.push({
    invoiceId,
    subscriptionId: subscriptionId || null,
    customerId: customerId || null,
    amount: Number(amountUSD),
    userEmail: userEmail || null,
    date: new Date(),
    note: note || "invoice.payment_succeeded",
  });
  affiliate.payoutDue = Number(affiliate.payoutDue || 0) + Number(amountUSD);
  await affiliate.save();
  return true;
}

async function maybeAutoPayout(affiliate: any, invoiceId: string) {
  const minUSD = Number(process.env.AFFILIATE_MIN_PAYOUT_USD || 50);
  const autopay = envBool("AFFILIATE_AUTOPAY", false);
  const dueUSD = Number(affiliate.payoutDue || 0);
  if (dueUSD < minUSD) return;

  const amountUSD = Math.floor(dueUSD * 100) / 100;
  const idempotencyKey = `${affiliate._id}:${invoiceId}`;

  const existing = await AffiliatePayout.findOne({ idempotencyKey }).lean();
  if (existing) return;

  const canAutopay =
    autopay &&
    affiliate.stripeConnectId &&
    (affiliate.connectedAccountStatus === "verified" || affiliate.onboardingCompleted === true);

  if (!canAutopay) {
    await AffiliatePayout.create({
      affiliateId: String(affiliate._id),
      affiliateEmail: affiliate.email,
      amount: amountUSD,
      currency: "usd",
      status: "queued",
      idempotencyKey,
    });
    return;
  }

  try {
    const transfer = await stripe.transfers.create({
      amount: toCents(amountUSD),
      currency: "usd",
      destination: affiliate.stripeConnectId,
      description: `Affiliate payout for ${affiliate.promoCode} (inv ${invoiceId})`,
    });

    await AffiliatePayout.create({
      affiliateId: String(affiliate._id),
      affiliateEmail: affiliate.email,
      amount: amountUSD,
      currency: "usd",
      stripeTransferId: transfer.id,
      status: "sent",
      idempotencyKey,
    });

    affiliate.payoutDue = Math.max(0, Number(affiliate.payoutDue || 0) - amountUSD);
    affiliate.totalPayoutsSent = Number(affiliate.totalPayoutsSent || 0) + amountUSD;
    affiliate.lastPayoutDate = new Date();
    await affiliate.save();
  } catch (e) {
    await AffiliatePayout.create({
      affiliateId: String(affiliate._id),
      affiliateEmail: affiliate.email,
      amount: amountUSD,
      currency: "usd",
      status: "failed",
      idempotencyKey,
    });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  try { await dbConnect(); } catch (e) { console.error("dbConnect failed:", e); }

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;

        let connectedAccountStatus: "pending" | "incomplete" | "restricted" | "verified" = "pending";
        if (account.requirements?.currently_due?.length) connectedAccountStatus = "incomplete";
        if (account.requirements?.disabled_reason) connectedAccountStatus = "restricted";
        if (account.charges_enabled && account.payouts_enabled && account.details_submitted) {
          connectedAccountStatus = "verified";
        }
        const onboardingCompleted =
          !!account.details_submitted && !!account.charges_enabled && !!account.payouts_enabled;

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
        const before = await Affiliate.findOne({ promoCode: U(promo.code) }).lean();
        const aff = await upsertAffiliateFromPromo(promo);
        if (!before?.approved && aff?.approved) {
          try {
            const url =
              process.env.NEXTAUTH_URL &&
              `${process.env.NEXTAUTH_URL}${process.env.AFFILIATE_RETURN_PATH || "/dashboard?tab=settings"}`;
            await sendAffiliateApprovedEmail({
              to: aff.email,
              name: aff.name,
              code: U(promo.code),
              promoCode: U(promo.code),
              dashboardUrl: url || undefined,
            });
          } catch {}
        }
        break;
      }

      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;

        const email = s.customer_email || (s.customer_details?.email as string | undefined);
        const userId = s.metadata?.userId;
        const referralCodeUsed = U(s.metadata?.referralCodeUsed || "");

        if (!email || !userId) break;
        const user = await User.findById(userId);
        if (!user) break;

        (user as any).isProUser = true;

        const upgradeIncluded = (s.metadata?.upgradeIncluded || "false").toLowerCase() === "true";
        user.hasAI = isAdminFree(email) ? true : upgradeIncluded;

        user.plan = "Pro";
        user.stripeCustomerId = (s.customer as string) || user.stripeCustomerId || "";
        (user as any).subscribedAt = new Date();
        user.subscriptionStatus = "active";
        if (referralCodeUsed) (user as any).referredBy = referralCodeUsed;
        await user.save();

        // Ensure the affiliate record exists for the code used
        if (referralCodeUsed) {
          try {
            const list = await stripe.promotionCodes.list({ code: referralCodeUsed, limit: 1 });
            if (list.data[0]) await upsertAffiliateFromPromo(list.data[0]);
          } catch {}
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = inv.customer as string | undefined;

        const isFirst =
          inv.billing_reason === "subscription_create" ||
          (!!inv.subscription && inv.attempt_count === 1);

        // Identify the promo code actually used
        let codeText: string | null = null;

        const promoId = (inv.discount as any)?.promotion_code as string | undefined;
        if (promoId) {
          try {
            const pc = await stripe.promotionCodes.retrieve(promoId);
            codeText = pc.code || null;
            if (pc) await upsertAffiliateFromPromo(pc);
          } catch {}
        }

        let subscriptionId: string | null = (inv.subscription as string) || null;
        if (!codeText && subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            codeText =
              U(sub.metadata?.referralCodeUsed) ||
              U(sub.metadata?.appliedPromoCode) ||
              null;
            if (codeText) {
              const list = await stripe.promotionCodes.list({ code: codeText, limit: 1 });
              if (list.data[0]) await upsertAffiliateFromPromo(list.data[0]);
            }
          } catch {}
        }

        let userEmail: string | null = null;
        if (customerId) {
          const user = await User.findOne({ stripeCustomerId: customerId });
          if (user) {
            user.subscriptionStatus = "active";
            await user.save();
            userEmail = user.email;
            if (!codeText) codeText = U((user as any).referredBy);
          }
        }

        if (!codeText) break;
        const aff = await findAffiliateByPromoCode(codeText);
        if (!aff) break;

        const payoutUSD =
          Number(aff.flatPayoutAmount || 0) ||
          Number(process.env.AFFILIATE_DEFAULT_PAYOUT || 25);

        const credited = await creditAffiliateOnce({
          affiliate: aff,
          invoiceId: String(inv.id || ""),
          subscriptionId,
          customerId: customerId || null,
          userEmail,
          amountUSD: payoutUSD,
          isFirstInvoice: isFirst,
          note: codeText ? `commission for ${codeText}` : "invoice.payment_succeeded",
        });

        // revenue tracking
        const cents = Number(inv.amount_paid || 0);
        aff.totalRevenueGenerated = Number(aff.totalRevenueGenerated || 0) + cents / 100;
        if (isFirst && userEmail) {
          aff.totalReferrals = Number(aff.totalReferrals || 0) + 1;
          aff.referrals = aff.referrals || [];
          if (!aff.referrals.some((r: any) => r?.email?.toLowerCase() === userEmail!.toLowerCase())) {
            aff.referrals.push({ email: userEmail, joinedAt: new Date() });
          }
        }
        await aff.save();

        if (credited) await maybeAutoPayout(aff, String(inv.id || ""));
        break;
      }

      case "credit_note.created": {
        const note = event.data.object as Stripe.CreditNote;
        const invoiceId = (note.invoice as string) || "";
        if (!invoiceId) break;

        // Resolve the affiliate again (like above)
        let aff: any = null;
        try {
          const inv = await stripe.invoices.retrieve(invoiceId);
          let code: string | null = null;

          const promoId = (inv.discount as any)?.promotion_code as string | undefined;
          if (promoId) {
            try {
              const pc = await stripe.promotionCodes.retrieve(promoId);
              code = pc.code || null;
            } catch {}
          }
          if (!code && inv.subscription) {
            try {
              const sub = await stripe.subscriptions.retrieve(inv.subscription as string);
              code = U(sub.metadata?.referralCodeUsed) || U(sub.metadata?.appliedPromoCode) || null;
            } catch {}
          }
          if (!code && inv.customer) {
            const u = await User.findOne({ stripeCustomerId: inv.customer as string });
            if (u) code = U((u as any).referredBy);
          }
          if (code) aff = await findAffiliateByPromoCode(code);
        } catch {}

        if (!aff) break;

        // Flat reversal (mirrors your flat-commission policy)
        const flatUSD =
          Number(aff.flatPayoutAmount || 0) ||
          Number(process.env.AFFILIATE_DEFAULT_PAYOUT || 25);
        const negative = -1 * flatUSD;

        aff.payoutHistory = aff.payoutHistory || [];
        aff.payoutHistory.push({
          amount: negative,
          userEmail: null,
          date: new Date(),
          invoiceId,
          note: `refund reversal (credit_note ${note.id})`,
        });
        aff.payoutDue = Number(aff.payoutDue || 0) + negative;
        await aff.save();
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        const activeLike = sub.status === "active" || sub.status === "trialing";
        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.subscriptionStatus = activeLike ? "active" : "canceled";
          const AI_PRICE_ID = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "";
          const hasAi = !!sub.items?.data?.some((it) => it.price?.id === AI_PRICE_ID);
          user.hasAI = isAdminFree(user.email) ? true : (activeLike && hasAi);
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
          if (!isAdminFree(user.email)) user.hasAI = false;
          await user.save();
        }
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subscriptionId = inv.subscription as string;

        try {
          const users = await User.find({ "numbers.subscriptionId": subscriptionId });
          for (const user of users) {
            const number: any = (user as any).numbers?.find((n: any) => n.subscriptionId === subscriptionId);
            if (!number) continue;

            try { await stripe.subscriptions.cancel(subscriptionId); } catch {}
            try { await (twilioClient as any).incomingPhoneNumbers(number.sid).remove(); } catch {}

            (user as any).numbers = (user as any).numbers.filter((n: any) => n.subscriptionId !== subscriptionId);
            await user.save();
          }
        } catch (e) {
          console.error("invoice.payment_failed cleanup error:", e);
        }
        break;
      }

      case "transfer.created": {
        const t = event.data.object as Stripe.Transfer;
        await AffiliatePayout.updateOne({ stripeTransferId: t.id }, { $set: { status: "sent" } });
        break;
      }
      case "transfer.reversed": {
        const t = event.data.object as Stripe.Transfer;
        await AffiliatePayout.updateOne({ stripeTransferId: t.id }, { $set: { status: "failed" } });
        break;
      }

      default:
        // ignore other events
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("Webhook handler error:", err?.message || err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}
