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

/* -------------------------- small helpers -------------------------- */
const envBool = (name: string, def = false) => {
  const v = process.env[name];
  if (v == null) return def;
  return v === "1" || v.toLowerCase() === "true";
};

const ADMIN_FREE_AI_EMAILS: string[] = (process.env.ADMIN_FREE_AI_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const isAdminFree = (email?: string | null) =>
  !!email && ADMIN_FREE_AI_EMAILS.includes(email.toLowerCase());

const safeUpper = (s?: string | null) => (s || "").trim().toUpperCase();
const toCents = (usd: number) => Math.round(Number(usd || 0) * 100);

async function findAffiliateByPromoCode(code: string) {
  const q = safeUpper(code);
  if (!q) return null;
  let a = await Affiliate.findOne({ promoCode: q });
  if (a) return a;
  a = await Affiliate.findOne({ promoCode: { $regex: `^${q}$`, $options: "i" } });
  return a;
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

/** Idempotent credit: refuses to re-credit the same invoice and avoids double first-commission per user/email. */
async function creditAffiliateOnce(opts: CreditOnceOpts) {
  const {
    affiliate,
    invoiceId,
    subscriptionId,
    customerId,
    userEmail,
    amountUSD,
    isFirstInvoice,
    note,
  } = opts;

  affiliate.payoutHistory = affiliate.payoutHistory || [];

  const alreadyByInvoice = affiliate.payoutHistory.some(
    (p: any) => p?.invoiceId && p.invoiceId === invoiceId,
  );
  if (alreadyByInvoice) {
    console.log(`[webhook] invoice ${invoiceId} already credited for ${affiliate.promoCode}`);
    return false;
  }

  if (isFirstInvoice && userEmail) {
    const alreadyByEmail = affiliate.payoutHistory.some(
      (p: any) => p?.userEmail && p.userEmail.toLowerCase() === userEmail.toLowerCase(),
    );
    if (alreadyByEmail) {
      console.log(`[webhook] first-invoice for ${userEmail} already credited for ${affiliate.promoCode}`);
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
  console.log(`💰 credited $${amountUSD.toFixed(2)} to ${affiliate.promoCode} (invoice ${invoiceId})`);
  return true;
}

/**
 * Auto/queued payout when affiliate.payoutDue >= AFFILIATE_MIN_PAYOUT_USD.
 * - If AFFILIATE_AUTOPAY=1 and account verified, create a Stripe transfer now.
 * - Else queue an AffiliatePayout row (status 'queued') for later manual send.
 * Uses idempotency via AffiliatePayout.idempotencyKey keyed by affiliate + invoiceId.
 */
async function maybeAutoPayout(affiliate: any, invoiceId: string, eventId?: string) {
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
    console.log(`🧾 queued affiliate payout $${amountUSD.toFixed(2)} for ${affiliate.promoCode} (no autopay)`);
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

    console.log(`✅ sent affiliate payout $${amountUSD.toFixed(2)} to ${affiliate.promoCode} (transfer ${transfer.id})`);
  } catch (e: any) {
    console.error("❌ Stripe transfer failed:", e?.message || e);
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

/* ------------------------------ handler ----------------------------- */
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

  const type = event.type;
  console.log("[stripe] event:", type);

  try {
    switch (type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;

        let connectedAccountStatus: string = "pending";
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

        console.log(`🔔 account.updated → ${account.id} status=${connectedAccountStatus}`);
        break;
      }

      case "promotion_code.created":
      case "promotion_code.updated": {
        const promo = event.data.object as Stripe.PromotionCode;
        const code = safeUpper(promo.code);
        if (!code) break;

        const aff = await findAffiliateByPromoCode(code);
        if (!aff) break;

        const wasApproved = !!(aff as any).approved;
        const nowApproved = !!promo.active;

        (aff as any).promotionCodeId = promo.id;
        (aff as any).couponId =
          typeof promo.coupon === "string" ? promo.coupon : promo.coupon?.id;

        (aff as any).approved = nowApproved;
        if (nowApproved && !wasApproved) (aff as any).approvedAt = new Date();

        await aff.save();

        if (nowApproved && !wasApproved) {
          try {
            const dashboardUrl =
              process.env.NEXTAUTH_URL &&
              `${process.env.NEXTAUTH_URL}${process.env.AFFILIATE_RETURN_PATH || "/dashboard?tab=settings"}`;
            await sendAffiliateApprovedEmail({
              to: aff.email,
              name: aff.name,
              code,
              promoCode: code,
              dashboardUrl: dashboardUrl || undefined,
            });
          } catch (e: any) {
            console.warn("⚠️ sendAffiliateApprovedEmail failed:", e?.message || e);
          }
        }
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const email =
          session.customer_email ||
          (session.customer_details?.email as string | undefined);
        const userId = session.metadata?.userId;
        const referralCodeUsed = session.metadata?.referralCodeUsed || null;

        if (!email || !userId) break;

        const user = await User.findById(userId);
        if (!user) break;

        (user as any).isProUser = true;

        const upgradeIncluded =
          (session.metadata?.upgradeIncluded || "false").toLowerCase() === "true";

        user.hasAI = isAdminFree(email) ? true : upgradeIncluded;

        user.plan = "Pro";
        user.stripeCustomerId =
          (session.customer as string) || user.stripeCustomerId || "";
        (user as any).subscribedAt = new Date();
        user.subscriptionStatus = "active";
        if (referralCodeUsed && referralCodeUsed !== "none") {
          (user as any).referredBy = referralCodeUsed;
        }
        await user.save();

        // Optional: initial referral bookkeeping (real commissions are on invoice events)
        if (referralCodeUsed && referralCodeUsed !== "none") {
          const affiliate = await findAffiliateByPromoCode(referralCodeUsed);
          if (affiliate) {
            const already = (affiliate as any).payoutHistory?.some(
              (p: any) => p.userEmail && p.userEmail.toLowerCase() === email.toLowerCase(),
            );
            if (!already) {
              const earned = Number(process.env.AFFILIATE_DEFAULT_PAYOUT || 25);
              (affiliate as any).totalReferrals = Number(affiliate.totalReferrals || 0) + 1;
              (affiliate as any).payoutDue = Number(affiliate.payoutDue || 0) + earned;
              (affiliate as any).referrals = (affiliate as any).referrals || [];
              (affiliate as any).referrals.push({ email, joinedAt: new Date() });
              (affiliate as any).payoutHistory = (affiliate as any).payoutHistory || [];
              (affiliate as any).payoutHistory.push({
                amount: earned,
                userEmail: email,
                date: new Date(),
                note: "checkout.session.completed",
              });
              await affiliate.save();
            }
          }
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string | undefined;

        // If you want “first invoice only” logic, we still compute it:
        const isFirstInvoice =
          invoice.billing_reason === "subscription_create" ||
          (!!invoice.subscription && invoice.attempt_count === 1);

        // Try to resolve the promo code that was applied
        let promoCodeText: string | null = null;
        const promoId = (invoice.discount as any)?.promotion_code as string | undefined;
        if (promoId) {
          try {
            const pc = await stripe.promotionCodes.retrieve(promoId);
            promoCodeText = pc.code || null;
          } catch {}
        }

        // Fallback to subscription/user metadata
        let subscriptionId: string | null = (invoice.subscription as string) || null;
        if (!promoCodeText && subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            promoCodeText =
              safeUpper(sub.metadata?.referralCodeUsed) ||
              safeUpper(sub.metadata?.appliedPromoCode) ||
              null;
          } catch {}
        }

        let userEmail: string | null = null;
        if (customerId) {
          const user = await User.findOne({ stripeCustomerId: customerId });
          if (user) {
            user.subscriptionStatus = "active";
            await user.save();
            userEmail = user.email;
            if (!promoCodeText) promoCodeText = safeUpper((user as any).referredBy);
          }
        }

        if (!promoCodeText) break;

        const affiliate = await findAffiliateByPromoCode(promoCodeText);
        if (!affiliate) break;

        // Flat payout per paid invoice (keep your existing policy)
        const payoutUSD =
          Number(affiliate.flatPayoutAmount || 0) ||
          Number(process.env.AFFILIATE_DEFAULT_PAYOUT || 25);

        const invoiceIdSafe: string = String(invoice.id || "");

        const credited = await creditAffiliateOnce({
          affiliate,
          invoiceId: invoiceIdSafe,
          subscriptionId,
          customerId: customerId || null,
          userEmail,
          amountUSD: payoutUSD,
          isFirstInvoice,
          note: promoCodeText ? `commission for ${promoCodeText}` : "invoice.payment_succeeded",
        });

        // Track gross revenue generated
        const paidCents = Number(invoice.amount_paid || 0);
        (affiliate as any).totalRevenueGenerated =
          Number(affiliate.totalRevenueGenerated || 0) + paidCents / 100;

        // Maintain referral list on first invoice
        if (isFirstInvoice && userEmail) {
          (affiliate as any).totalReferrals = Number(affiliate.totalReferrals || 0) + 1;
          (affiliate as any).referrals = (affiliate as any).referrals || [];
          const already = (affiliate as any).referrals.some(
            (r: any) => r?.email?.toLowerCase() === userEmail!.toLowerCase(),
          );
          if (!already) {
            (affiliate as any).referrals.push({ email: userEmail, joinedAt: new Date() });
          }
        }

        await affiliate.save();

        // Optionally auto/queue payout if over threshold (idempotent by invoice)
        if (credited) {
          await maybeAutoPayout(affiliate, invoiceIdSafe, event.id);
        }
        break;
      }

      // Refund/credit reversals — create a negative commission entry based on credit note subtotal
      case "credit_note.created": {
        const note = event.data.object as Stripe.CreditNote;
        const invoiceId = (note.invoice as string) || "";
        if (!invoiceId) break;

        // Pull invoice to resolve referral/affiliate again
        let aff: any = null;
        try {
          const inv = await stripe.invoices.retrieve(invoiceId, { expand: ["discounts.promotion_code"] });
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
              code =
                safeUpper(sub.metadata?.referralCodeUsed) ||
                safeUpper(sub.metadata?.appliedPromoCode) ||
                null;
            } catch {}
          }
          if (!code && inv.customer) {
            const u = await User.findOne({ stripeCustomerId: inv.customer as string });
            if (u) code = safeUpper((u as any).referredBy);
          }
          if (code) aff = await findAffiliateByPromoCode(code);
        } catch {}

        if (!aff) break;

        const refundBaseCents =
          typeof note.subtotal === "number" ? note.subtotal :
          typeof note.amount === "number" ? note.amount :
          0;

        if (refundBaseCents <= 0) break;

        // Mirror your commission policy: flat or %.
        // If you ever move to a percentage, compute from refundBaseCents here.
        const flatUSD =
          Number(aff.flatPayoutAmount || 0) ||
          Number(process.env.AFFILIATE_DEFAULT_PAYOUT || 25);

        const negativeCommission = -1 * flatUSD;

        aff.payoutHistory = aff.payoutHistory || [];
        aff.payoutHistory.push({
          amount: negativeCommission,
          userEmail: null,
          date: new Date(),
          invoiceId,
          note: `refund reversal (credit_note ${note.id})`,
        });
        aff.payoutDue = Number(aff.payoutDue || 0) + negativeCommission;
        await aff.save();
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        const subStatus = sub.status; // includes 'trialing'
        const isActiveLike = subStatus === "active" || subStatus === "trialing";

        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.subscriptionStatus = isActiveLike ? "active" : "canceled";

          const AI_PRICE_ID = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "";
          const isAiPriceId = (id?: string | null) => !!id && !!AI_PRICE_ID && id === AI_PRICE_ID;
          const hasAiItem = !!sub.items?.data?.some((it) => isAiPriceId(it.price?.id));

          if (isAdminFree(user.email)) {
            user.hasAI = true;
          } else {
            user.hasAI = isActiveLike && hasAiItem;
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
          if (!isAdminFree(user.email)) user.hasAI = false;
          await user.save();
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;

        try {
          const users = await User.find({ "numbers.subscriptionId": subscriptionId });
          for (const user of users) {
            const number: any = (user as any).numbers?.find(
              (n: any) => n.subscriptionId === subscriptionId,
            );
            if (!number) continue;

            try {
              await stripe.subscriptions.cancel(subscriptionId);
            } catch {}

            try {
              await (twilioClient as any).incomingPhoneNumbers(number.sid).remove();
            } catch {}

            (user as any).numbers = (user as any).numbers.filter(
              (n: any) => n.subscriptionId !== subscriptionId,
            );
            await user.save();
          }
        } catch (err) {
          console.error("❌ Error handling invoice.payment_failed:", err);
        }
        break;
      }

      case "transfer.created": {
        const transfer = event.data.object as Stripe.Transfer;
        await AffiliatePayout.updateOne(
          { stripeTransferId: transfer.id },
          { $set: { status: "sent" } },
        );
        break;
      }
      case "transfer.reversed": {
        const transfer = event.data.object as Stripe.Transfer;
        await AffiliatePayout.updateOne(
          { stripeTransferId: transfer.id },
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
