// /pages/api/stripe/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import { stripe } from "@/lib/stripe"; // shared client (no apiVersion pin)
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
  // Exact match first
  let a = await Affiliate.findOne({ promoCode: q });
  if (a) return a;
  // Case-insensitive fallback
  a = await Affiliate.findOne({
    promoCode: { $regex: `^${q}$`, $options: "i" },
  });
  return a;
}

/** idempotent credit: refuses to re-credit same invoice or same user on first invoice */
async function creditAffiliateOnce(opts: {
  affiliate: any;
  invoiceId: string;
  subscriptionId?: string | null;
  customerId?: string | null;
  userEmail?: string | null;
  amountUSD: number;
  isFirstInvoice: boolean;
  note?: string;
}) {
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

  // New idempotency: by invoiceId (will only work if your schema stores invoiceId)
  const alreadyByInvoice = affiliate.payoutHistory.some(
    (p: any) => p?.invoiceId && p.invoiceId === invoiceId,
  );
  if (alreadyByInvoice) {
    console.log(
      `[webhook] invoice ${invoiceId} already credited for ${affiliate.promoCode}`,
    );
    return false;
  }

  // Legacy guard: old entries may only have userEmail (for first invoice)
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

  // Push record (extra fields are ignored if not in schema; kept for future schema expansion)
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

  // DB up
  try {
    await dbConnect();
  } catch (e) {
    console.error("dbConnect failed:", e);
    // continue; specific handlers can be best-effort
  }

  const type = event.type;
  console.log("[stripe] event:", type);

  try {
    switch (type) {
      /* ------------------- Connect: onboarding/account status ------------------- */
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

      /* ----------------- Auto-approve affiliate when Promotion Code goes live ---------------- */
      case "promotion_code.created":
      case "promotion_code.updated": {
        const promo = event.data.object as Stripe.PromotionCode;
        const code = safeUpper(promo.code);
        if (!code) {
          console.log("⚠️ promotion_code.* without code; ignoring");
          break;
        }

        const aff = await findAffiliateByPromoCode(code);
        if (!aff) {
          console.log(`ℹ️ promotion_code ${code} did not match any affiliate`);
          break;
        }

        const wasApproved = !!(aff as any).approved;
        const nowApproved = !!promo.active;

        (aff as any).promotionCodeId = promo.id;
        (aff as any).couponId =
          typeof promo.coupon === "string" ? promo.coupon : promo.coupon?.id;

        (aff as any).approved = nowApproved;
        if (nowApproved && !wasApproved) (aff as any).approvedAt = new Date();

        await aff.save();

        console.log(
          `✅ promotion_code.${type.split(".")[1]} → ${code} approved=${nowApproved}`,
        );

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

      /* --------------- Checkout success (keep for any Checkout flows you use) --------------- */
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const email =
          session.customer_email ||
          (session.customer_details?.email as string | undefined);
        const userId = session.metadata?.userId;
        const referralCodeUsed = session.metadata?.referralCodeUsed || null;

        if (!email || !userId) {
          console.error(
            "❌ Missing metadata (email/userId) on checkout.session.completed",
          );
          break;
        }

        const user = await User.findById(userId);
        if (!user) {
          console.warn("⚠️ checkout.session.completed: user not found", userId);
          break;
        }

        (user as any).isProUser = true;
        user.hasAI = true;
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
              console.log(
                `💰 Affiliate credited $${earned} from ${email} using code ${referralCodeUsed}`,
              );
            }
          }
        }
        break;
      }

      /* ------------------------- Subscription invoices (credit commission) ------------------------- */
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string | undefined;

        // Respect recurring flag (default false => first invoice only)
        const recurring = envBool("AFFILIATE_PAYOUT_RECURRING", false);
        const isFirstInvoice =
          invoice.billing_reason === "subscription_create" ||
          (!!invoice.subscription && invoice.attempt_count === 1);

        if (!recurring && !isFirstInvoice) {
          console.log(
            `[webhook] skipping recurring invoice ${invoice.id} (first-invoice only)`,
          );
          break;
        }

        // Determine affiliate code:
        // (A) invoice.discount.promotion_code -> code
        let promoCodeText: string | null = null;
        const promoId = (invoice.discount as any)?.promotion_code as
          | string
          | undefined;
        if (promoId) {
          try {
            const pc = await stripe.promotionCodes.retrieve(promoId);
            promoCodeText = pc.code || null;
          } catch (e) {
            console.warn("⚠️ failed to retrieve promotion_code", promoId, e);
          }
        }

        // (B) fallback: subscription.metadata.referralCodeUsed / appliedPromoCode
        let subscriptionId: string | null =
          (invoice.subscription as string) || null;
        if (!promoCodeText && subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            promoCodeText =
              safeUpper(sub.metadata?.referralCodeUsed) ||
              safeUpper(sub.metadata?.appliedPromoCode) ||
              null;
          } catch (e) {
            console.warn(
              "⚠️ failed to retrieve subscription for invoice",
              invoice.id,
              e,
            );
          }
        }

        // (C) final fallback: user.referredBy if we can resolve the user
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

        if (!promoCodeText) {
          console.log(
            `[webhook] no affiliate promo found for invoice ${invoice.id}`,
          );
          break;
        }

        const affiliate = await findAffiliateByPromoCode(promoCodeText);
        if (!affiliate) {
          console.log(
            `[webhook] affiliate not found for promo ${promoCodeText}`,
          );
          break;
        }

        const payoutUSD =
          Number(affiliate.flatPayoutAmount || 0) ||
          Number(process.env.AFFILIATE_DEFAULT_PAYOUT || 25);

        // Idempotent credit (guards invoice & legacy-by-email)
        await creditAffiliateOnce({
          affiliate,
          invoiceId: invoice.id,
          subscriptionId,
          customerId: customerId || null,
          userEmail,
          amountUSD: payoutUSD,
          isFirstInvoice,
          note: promoCodeText
            ? `commission for ${promoCodeText}`
            : "invoice.paid",
        });

        // Track total revenue (paid) for analytics
        const paidCents = Number(invoice.amount_paid || 0);
        (affiliate as any).totalRevenueGenerated =
          Number(affiliate.totalRevenueGenerated || 0) + paidCents / 100;

        // Count referral on first invoice
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
        console.log(
          `✅ invoice ${invoice.id} paid $${asUSD(invoice.amount_paid)} (promo=${promoCodeText}); affiliate ${affiliate.promoCode} updated`,
        );
        break;
      }

      /* ------------------------- Subscription status sync ------------------------- */
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          const status =
            sub.status === "active" || sub.status === "trialing"
              ? "active"
              : "canceled";
          user.subscriptionStatus = status;
          await user.save();
          console.log(
            `🔄 customer.subscription.updated → ${status} for ${user.email} (stripe: ${sub.status})`,
          );
        }
        break;
      }

      /* -------- Invoice failed → cancel number subscription & release Twilio number -------- */
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
            } catch (err) {
              console.warn("⚠️ Stripe cancellation failed:", err);
            }

            try {
              await (twilioClient as any)
                .incomingPhoneNumbers(number.sid)
                .remove();
            } catch (err) {
              console.warn("⚠️ Twilio number release failed:", err);
            }

            (user as any).numbers = (user as any).numbers.filter(
              (n: any) => n.subscriptionId !== subscriptionId,
            );
            await user.save();

            console.log(
              `⚡️ Auto-canceled number ${number.phoneNumber} for ${user.email}`,
            );
          }
        } catch (err) {
          console.error("❌ Error handling invoice.payment_failed:", err);
        }
        break;
      }

      /* -------------------- Affiliate payout transfer status updates -------------------- */
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
        // No-op for other events to keep logs clean
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("Webhook handler error:", err?.message || err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}
