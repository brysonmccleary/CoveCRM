import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import User from "@/models/User";
import twilioClient from "@/lib/twilioClient";
import AffiliatePayout from "@/models/AffiliatePayout";
import { sendAffiliateApprovedEmail } from "@/lib/email";

export const config = { api: { bodyParser: false } };

/* -------------------------- small helpers -------------------------- */
const envBool = (name: string, def = false) => {
  const v = process.env[name];
  if (v == null) return def;
  return v === "1" || v.toLowerCase() === "true";
};

const asUSD = (cents?: number | null) =>
  (Math.max(0, cents || 0) / 100).toFixed(2);

const safeUpper = (s?: string | null) => (s || "").trim().toUpperCase();

async function findAffiliateByPromoCode(code: string) {
  const q = safeUpper(code);
  if (!q) return null;
  let a = await Affiliate.findOne({ promoCode: q });
  if (a) return a;
  a = await Affiliate.findOne({
    promoCode: { $regex: `^${q}$`, $options: "i" },
  });
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

/** idempotent credit: refuses to re-credit same invoice or same user on first invoice */
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
    console.log(
      `[webhook] invoice ${invoiceId} already credited for ${affiliate.promoCode}`,
    );
    return false;
  }

  if (isFirstInvoice && userEmail) {
    const alreadyByEmail = affiliate.payoutHistory.some(
      (p: any) =>
        p?.userEmail && p.userEmail.toLowerCase() === userEmail.toLowerCase(),
    );
    if (alreadyByEmail) {
      console.log(
        `[webhook] first-invoice for ${userEmail} already credited for ${affiliate.promoCode}`,
      );
      return false;
    }
  }

  affiliate.payoutHistory.push({
    invoiceId,
    subscriptionId: subscriptionId || null,
    customerId: customerId || null,
    amount: amountUSD,
    userEmail: userEmail || null,
    date: new Date(),
    note: note || "invoice.paid",
  });

  affiliate.payoutDue = Number(affiliate.payoutDue || 0) + Number(amountUSD);

  await affiliate.save();
  console.log(
    `💰 credited $${amountUSD.toFixed(2)} to affiliate ${affiliate.promoCode} (invoice ${invoiceId})`,
  );
  return true;
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

        console.log(
          `🔔 account.updated → ${account.id} status=${connectedAccountStatus}`,
        );
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
            console.warn(
              "⚠️ sendAffiliateApprovedEmail failed:",
              e?.message || e,
            );
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

        // Toggle AI based on what you requested at checkout
        const upgradeIncluded = (session.metadata?.upgradeIncluded || "false").toLowerCase() === "true";
        user.hasAI = upgradeIncluded;

        user.plan = "Pro";
        user.stripeCustomerId =
          (session.customer as string) || user.stripeCustomerId || "";
        (user as any).subscribedAt = new Date();
        user.subscriptionStatus = "active";
        if (referralCodeUsed && referralCodeUsed !== "none") {
          (user as any).referredBy = referralCodeUsed;
        }
        await user.save();

        if (referralCodeUsed && referralCodeUsed !== "none") {
          const affiliate = await findAffiliateByPromoCode(referralCodeUsed);
          if (affiliate) {
            const alreadyCredited = (affiliate as any).payoutHistory?.some(
              (p: any) =>
                p.userEmail &&
                p.userEmail.toLowerCase() === email.toLowerCase(),
            );
            if (!alreadyCredited) {
              const earned = Number(process.env.AFFILIATE_DEFAULT_PAYOUT || 25);
              (affiliate as any).totalReferrals =
                Number(affiliate.totalReferrals || 0) + 1;
              (affiliate as any).payoutDue =
                Number(affiliate.payoutDue || 0) + earned;
              (affiliate as any).referrals = (affiliate as any).referrals || [];
              (affiliate as any).referrals.push({
                email,
                joinedAt: new Date(),
              });
              (affiliate as any).payoutHistory =
                (affiliate as any).payoutHistory || [];
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

        const recurring = envBool("AFFILIATE_PAYOUT_RECURRING", false);
        const isFirstInvoice =
          invoice.billing_reason === "subscription_create" ||
          (!!invoice.subscription && invoice.attempt_count === 1);

        if (!recurring && !isFirstInvoice) break;

        let promoCodeText: string | null = null;
        const promoId = (invoice.discount as any)?.promotion_code as
          | string
          | undefined;
        if (promoId) {
          try {
            const pc = await stripe.promotionCodes.retrieve(promoId);
            promoCodeText = pc.code || null;
          } catch {}
        }

        let subscriptionId: string | null =
          (invoice.subscription as string) || null;
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
            if (!promoCodeText)
              promoCodeText = safeUpper((user as any).referredBy);
          }
        }

        if (!promoCodeText) break;

        const affiliate = await findAffiliateByPromoCode(promoCodeText);
        if (!affiliate) break;

        const payoutUSD =
          Number(affiliate.flatPayoutAmount || 0) ||
          Number(process.env.AFFILIATE_DEFAULT_PAYOUT || 25);

        const invoiceIdSafe: string = String(invoice.id || "");

        await creditAffiliateOnce({
          affiliate,
          invoiceId: invoiceIdSafe,
          subscriptionId,
          customerId: customerId || null,
          userEmail,
          amountUSD: payoutUSD,
          isFirstInvoice,
          note: promoCodeText
            ? `commission for ${promoCodeText}`
            : "invoice.paid",
        });

        const paidCents = Number(invoice.amount_paid || 0);
        (affiliate as any).totalRevenueGenerated =
          Number(affiliate.totalRevenueGenerated || 0) + paidCents / 100;

        if (isFirstInvoice && userEmail) {
          (affiliate as any).totalReferrals =
            Number(affiliate.totalReferrals || 0) + 1;
          (affiliate as any).referrals = (affiliate as any).referrals || [];
          const already = (affiliate as any).referrals.some(
            (r: any) => r?.email?.toLowerCase() === userEmail!.toLowerCase(),
          );
          if (!already) {
            (affiliate as any).referrals.push({
              email: userEmail,
              joinedAt: new Date(),
            });
          }
        }

        await affiliate.save();
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        // Is the subscription active-like?
        const subStatus = sub.status; // Stripe types include 'trialing'
        const isActiveLike = subStatus === "active" || subStatus === "trialing";

        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.subscriptionStatus = isActiveLike ? "active" : "canceled";

          // Toggle AI based on presence of AI price in items AND active-like status
          const AI_PRICE_ID = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "";
          const isAiPriceId = (id?: string | null) =>
            !!id && !!AI_PRICE_ID && id === AI_PRICE_ID;

          const hasAiItem =
            !!sub.items?.data?.some((it) => isAiPriceId(it.price?.id));

          user.hasAI = isActiveLike && hasAiItem;

          await user.save();
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;

        try {
          const users = await User.find({
            "numbers.subscriptionId": subscriptionId,
          });
          for (const user of users) {
            const number: any = (user as any).numbers?.find(
              (n: any) => n.subscriptionId === subscriptionId,
            );
            if (!number) continue;

            try {
              await stripe.subscriptions.cancel(subscriptionId);
            } catch {}

            try {
              await (twilioClient as any)
                .incomingPhoneNumbers(number.sid)
                .remove();
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
