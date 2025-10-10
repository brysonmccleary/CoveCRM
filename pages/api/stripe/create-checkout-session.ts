// pages/api/stripe/create-checkout-session.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";

/** Helpers */
const safeUpper = (s?: string | null) => (s || "").trim().toUpperCase();

/** Find a single Affiliate by promo code (case-insensitive). Returns a Mongoose doc or null. */
async function findAffiliateByPromoCode(code?: string) {
  const q = safeUpper(code);
  if (!q) return null;
  // Try exact (fast), then case-insensitive fallback
  const exact = await Affiliate.findOne({ promoCode: q });
  if (exact) return exact;
  return await Affiliate.findOne({ promoCode: { $regex: `^${q}$`, $options: "i" } });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).end("Unauthorized");

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).end("User not found");

  const { wantsUpgrade, referralCode } = (req.body || {}) as {
    wantsUpgrade?: boolean;
    referralCode?: string; // optional code user typed during upgrade
  };

  // Your default prices (env overrides)
  const BASE_PRICE = process.env.STRIPE_PRICE_ID_MONTHLY || "price_1RoAGJDF9aEsjVyJV2wARrFp";
  const AI_PRICE = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "price_1RoAK4DF9aEsjVyJeoR3w3RL";

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: BASE_PRICE, quantity: 1 },
  ];

  if (wantsUpgrade) {
    line_items.push({ price: AI_PRICE, quantity: 1 });
  }

  // Try to pre-apply a discount if we can resolve an affiliate promo/coupon now.
  // Priority: explicit referralCode from request, else whatever was already on the user.referredBy
  const codeMaybe = referralCode || (user as any)?.referredBy || undefined;
  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;

  if (codeMaybe) {
    const aff: any = await findAffiliateByPromoCode(codeMaybe);
    if (aff) {
      if (aff.promotionCodeId) {
        discounts = [{ promotion_code: aff.promotionCodeId as string }];
      } else if (aff.couponId) {
        discounts = [{ coupon: aff.couponId as string }];
      }
      // If neither is set, we'll still pass allow_promotion_codes below so the user can enter manually.
    }
  }

  const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId || undefined,          // reuse existing customer if present
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items,
      // Let Stripe promo codes UI appear even if we pre-apply a discount
      allow_promotion_codes: true,
      // If we found a valid affiliate promo/coupon, pre-apply it
      discounts,
      payment_method_types: ["card"],
      metadata: {
        userId: (user as any)?._id?.toString?.() || "",
        email: user.email,
        upgradeIncluded: wantsUpgrade ? "true" : "false",
        // Persist what we tried to use — webhook will validate/credit on invoice events anyway.
        referralCodeUsed: safeUpper(codeMaybe) || "none",
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
