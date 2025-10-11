import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Affiliate from "@/models/Affiliate"; // fallback when needed
import { stripe } from "@/lib/stripe";

const U = (s?: string | null) => (s || "").trim().toUpperCase();

function getBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const session = await getServerSession(req, res, authOptions as any);
  if (!session?.user?.email) return res.status(401).end("Unauthorized");

  const { wantsUpgrade, promoCode } = (req.body || {}) as {
    wantsUpgrade?: boolean;
    promoCode?: string; // optionally typed code from the form
  };

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).end("User not found");

  // Stripe price IDs
  const BASE_PRICE = process.env.STRIPE_PRICE_ID_MONTHLY || "price_XXXXXXXXXXXX_base";
  const AI_PRICE   = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "price_XXXXXXXXXXXX_ai";

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: BASE_PRICE, quantity: 1 }];
  if (wantsUpgrade) line_items.push({ price: AI_PRICE, quantity: 1 });

  // Try to pre-attach a discount so the Checkout total reflects it immediately.
  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
  const entered = U(promoCode);

  async function resolveStripePromo(code: string) {
    try {
      const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
      const pc = list.data?.[0];
      if (pc?.id) return { promotion_code: pc.id } as Stripe.Checkout.SessionCreateParams.Discount;
    } catch (e) {
      // ignore; Checkout still allows manual entry
    }
    return null;
  }
  async function resolveFromAffiliate(code: string) {
    try {
      const aff = await Affiliate.findOne({ promoCode: code }).lean();
      if (!aff) return null;
      if ((aff as any).promotionCodeId) return { promotion_code: (aff as any).promotionCodeId };
      if ((aff as any).couponId) return { coupon: (aff as any).couponId };
    } catch {}
    return null;
  }

  if (entered) {
    const viaStripe = await resolveStripePromo(entered);
    discounts = viaStripe ? [viaStripe] : undefined;
    if (!discounts) {
      const viaAff = await resolveFromAffiliate(entered);
      if (viaAff) discounts = [viaAff];
    }
  }

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items,
      allow_promotion_codes: true,
      ...(discounts ? { discounts } : {}), // pre-apply so the price shows discounted

      payment_method_types: ["card"],
      metadata: {
        userId: (user as any)?._id?.toString?.() || "",
        email: user.email,
        upgradeIncluded: wantsUpgrade ? "true" : "false",
        referralCodeUsed: entered || (user as any)?.referredBy || "none",
      },
      success_url: `${getBaseUrl()}/success?paid=true`,
      cancel_url: `${getBaseUrl()}/upgrade`,
    });

    return res.status(200).json({ url: checkout.url });
  } catch (err: any) {
    console.error("❌ Stripe checkout error:", err);
    return res.status(500).json({ error: err?.message || "Checkout failed" });
  }
}
