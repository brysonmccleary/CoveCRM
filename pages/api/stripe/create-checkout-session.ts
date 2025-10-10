import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";

/**
 * Helper: uppercase safely
 */
const safeUpper = (s?: string | null) => (s || "").trim().toUpperCase();

/**
 * Try to find an affiliate by promo code (case-insensitive).
 * Assumes your Affiliate model stores the visible code in `promoCode`,
 * and optionally stores a Stripe `promotionCodeId` or `couponId`.
 */
async function findAffiliateByPromoCode(code?: string | null) {
  const q = safeUpper(code);
  if (!q) return null;
  let a = await Affiliate.findOne({ promoCode: q }).lean();
  if (a) return a;
  a = await Affiliate.findOne({ promoCode: { $regex: `^${q}$`, $options: "i" } }).lean();
  return a;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).end("Unauthorized");

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).end("User not found");

  // From client: { wantsUpgrade, referralCode } (referralCode optional; can also come from user.referredBy)
  const { wantsUpgrade, referralCode: referralCodeBody } = (req.body || {}) as {
    wantsUpgrade?: boolean;
    referralCode?: string;
  };

  const BASE_PRICE = process.env.STRIPE_PRICE_ID_MONTHLY || "price_1RoAGJDF9aEsjVyJV2wARrFp";
  const AI_PRICE   = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "price_1RoAK4DF9aEsjVyJeoR3w3RL";

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: BASE_PRICE, quantity: 1 },
  ];
  if (wantsUpgrade) {
    line_items.push({ price: AI_PRICE, quantity: 1 });
  }

  const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  // Resolve a referral/affiliate code (priority: body > user.referredBy)
  const referralCodeUsed = safeUpper(referralCodeBody || (user as any)?.referredBy || "");
  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined = undefined;

  // If we have an affiliate, prefer forcing their promotion_code/coupon so the discount matches the affiliate.
  if (referralCodeUsed) {
    const aff = await findAffiliateByPromoCode(referralCodeUsed);
    if (aff) {
      if (aff.promotionCodeId) {
        discounts = [{ promotion_code: aff.promotionCodeId }];
      } else if (aff.couponId) {
        discounts = [{ coupon: aff.couponId }];
      }
    }
  }

  // Metadata propagated to both the Checkout Session and resulting Subscription
  const metadata = {
    userId: (user as any)?._id?.toString?.() || "",
    email: user.email,
    upgradeIncluded: wantsUpgrade ? "true" : "false",
    referralCodeUsed: referralCodeUsed || "none",
  };

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items,
      // You can keep this on to allow *other* promo codes, or switch to false to enforce only the affiliate discount:
      allow_promotion_codes: true,
      // If we resolved an affiliate promo/coupon, pre-apply it here:
      discounts,
      payment_method_types: ["card"],
      metadata,
      subscription_data: {
        metadata, // ensure the metadata flows to the subscription for future invoices
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      },
      success_url: `${BASE_URL}/success?paid=true`,
      cancel_url: `${BASE_URL}/upgrade`,
    });

    return res.status(200).json({ url: checkoutSession.url });
  } catch (err: any) {
    console.error("❌ Stripe checkout error:", err);
    return res.status(500).json({ error: err?.message || "Checkout failed" });
  }
}
