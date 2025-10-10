// pages/api/stripe/create-checkout-session.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Affiliate from "@/models/Affiliate"; // optional, used for metadata/fallback
import { stripe } from "@/lib/stripe";

const upper = (s?: string | null) => (s || "").trim().toUpperCase();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).end("Unauthorized");

  const { wantsUpgrade, promoCode } = (req.body || {}) as {
    wantsUpgrade?: boolean;
    promoCode?: string; // plain-text code user entered (e.g., "JANE10")
  };

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).end("User not found");

  // Price IDs (must be in the same Stripe mode as your keys: Test vs Live)
  const BASE_PRICE = process.env.STRIPE_PRICE_ID_MONTHLY || "price_XXXXXXXXXXXX_base";
  const AI_PRICE   = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "price_XXXXXXXXXXXX_ai";

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: BASE_PRICE, quantity: 1 },
  ];
  if (wantsUpgrade) {
    line_items.push({ price: AI_PRICE, quantity: 1 });
  }

  // Build success/cancel URLs
  const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  // Resolve a Stripe promotion_code or coupon to attach as `discounts`
  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined = undefined;

  // Helper: try to resolve a promotion code id directly from Stripe by CODE text.
  async function resolveStripePromoByCodeText(codeText: string) {
    try {
      // list() supports filtering by exact code; returns active codes that match casing-insensitively
      const list = await stripe.promotionCodes.list({ code: codeText, active: true, limit: 1 });
      const pc = list.data?.[0];
      if (pc?.id) {
        return { promotion_code: pc.id } as Stripe.Checkout.SessionCreateParams.Discount;
      }
    } catch (e) {
      // swallow—fall back to Affiliate or manual entry
      console.warn("promo list failed:", (e as any)?.message || e);
    }
    return null;
  }

  // Optional: fallback to Affiliate store if you keep promo/coupon ids there
  async function resolveFromAffiliateStore(codeText: string) {
    try {
      const aff = await Affiliate.findOne({
        $or: [{ promoCode: upper(codeText) }, { promoCode: new RegExp(`^${upper(codeText)}$`, "i") }],
      }).lean();
      if (!aff) return null;

      if ((aff as any).promotionCodeId) {
        return { promotion_code: (aff as any).promotionCodeId } as Stripe.Checkout.SessionCreateParams.Discount;
      }
      if ((aff as any).couponId) {
        return { coupon: (aff as any).couponId } as Stripe.Checkout.SessionCreateParams.Discount;
      }
    } catch (e) {
      console.warn("affiliate lookup failed:", (e as any)?.message || e);
    }
    return null;
  }

  // If the caller passed a promo code, try to attach it
  const enteredCode = upper(promoCode);
  if (enteredCode) {
    const viaStripe = await resolveStripePromoByCodeText(enteredCode);
    if (viaStripe) {
      discounts = [viaStripe];
    } else {
      const viaAffiliate = await resolveFromAffiliateStore(enteredCode);
      if (viaAffiliate) discounts = [viaAffiliate];
    }
  }

  // If no preattached discount, customers can still enter a code at checkout UI
  const allow_promotion_codes = true;

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Prefer existing customer to avoid dupes
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items,
      allow_promotion_codes,
      // If we successfully resolved the code, attach it explicitly here:
      ...(discounts ? { discounts } : {}),

      // (Optional) if you want to collect billing address for tax / invoices:
      // billing_address_collection: "required",

      payment_method_types: ["card"],
      metadata: {
        userId: (user as any)?._id?.toString?.() || "",
        email: user.email,
        upgradeIncluded: wantsUpgrade ? "true" : "false",
        referralCodeUsed: enteredCode || (user as any)?.referredBy || "none",
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
