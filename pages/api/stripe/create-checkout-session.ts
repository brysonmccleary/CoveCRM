import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";

const upper = (s?: string | null) => (s || "").trim().toUpperCase();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  // ✅ Cast to Session | null so TS knows about .user
  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  if (!session?.user?.email) return res.status(401).end("Unauthorized");

  const { wantsUpgrade, promoCode } = (req.body || {}) as {
    wantsUpgrade?: boolean;
    promoCode?: string; // plain text code entered by the user (e.g., "JANE10")
  };

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).end("User not found");

  // Price IDs must match your Stripe mode (Test vs Live)
  const BASE_PRICE = process.env.STRIPE_PRICE_ID_MONTHLY || "price_XXXXXXXXXXXX_base";
  const AI_PRICE   = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "price_XXXXXXXXXXXX_ai";

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: BASE_PRICE, quantity: 1 }];
  if (wantsUpgrade) line_items.push({ price: AI_PRICE, quantity: 1 });

  // Build URLs
  const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  // ---------- Robust discount resolver (promo preferred, coupon fallback) ----------
  async function resolvePromotionCodeId(codeText: string): Promise<string | null> {
    // 1) Fast exact filter
    const exact = await stripe.promotionCodes.list({ code: codeText, active: true, limit: 1 });
    if (exact.data?.[0]?.id) return exact.data[0].id;

    // 2) Case-insensitive scan (first page)
    const page = await stripe.promotionCodes.list({ active: true, limit: 100 });
    const lc = codeText.toLowerCase();
    const found = page.data.find(p => (p.code || "").toLowerCase() === lc);
    return found?.id || null;
  }

  async function resolveCouponId(codeText: string): Promise<string | null> {
    // 1) Try coupon id == code
    try {
      const byId = await stripe.coupons.retrieve(codeText);
      if ((byId as any)?.id) return byId.id;
    } catch { /* ignore */ }

    // 2) Case-insensitive by name (single page scan)
    const page = await stripe.coupons.list({ limit: 100 });
    const lc = codeText.toLowerCase();
    const found = page.data.find(c => (c.name || "").toLowerCase() === lc);
    return found?.id || null;
  }

  async function resolveDiscount(codeText: string): Promise<Stripe.Checkout.SessionCreateParams.Discount | null> {
    // Prefer a live promotion code
    const promoId = await resolvePromotionCodeId(codeText);
    if (promoId) return { promotion_code: promoId };

    // Fallback to coupon
    const couponId = await resolveCouponId(codeText);
    if (couponId) return { coupon: couponId };

    // As a last resort, check your Affiliate store mapping (if you saved ids there)
    try {
      const aff = await Affiliate.findOne({
        $or: [{ promoCode: upper(codeText) }, { promoCode: new RegExp(`^${upper(codeText)}$`, "i") }],
      }).lean();
      if (aff?.promotionCodeId) return { promotion_code: aff.promotionCodeId as string };
      if (aff?.couponId) return { coupon: aff.couponId as string };
    } catch { /* ignore */ }

    return null;
  }

  const enteredCode = upper(promoCode) || upper((user as any)?.usedCode) || upper((user as any)?.referredByCode);
  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;

  if (enteredCode) {
    const discountObj = await resolveDiscount(enteredCode);
    if (discountObj) discounts = [discountObj];
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Prefer existing customer id to avoid duplicates
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items,
      allow_promotion_codes: true, // still let customers enter codes in the UI
      ...(discounts ? { discounts } : {}), // pre-attach if we resolved one
      payment_method_types: ["card"],
      metadata: {
        userId: (user as any)?._id?.toString?.() || "",
        email: user.email,
        upgradeIncluded: wantsUpgrade ? "true" : "false",
        referralCodeUsed: enteredCode || "none",
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
