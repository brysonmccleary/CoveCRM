import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

type Out = {
  amount: number | null;            // base monthly (pre-discount), in USD
  effectiveAmount?: number | null;  // after discount/coupon, in USD
  discountLabel?: string | null;    // e.g. "Founders 20% off"
  currency?: string;                // e.g. "usd"
  hasAIUpgrade: boolean;
  adminView?: boolean;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Out | { error: string }>
) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const AI_PRICE_ID = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "";

  // No Stripe customer yet — still report current entitlement flags
  if (!user.stripeCustomerId) {
    return res.status(200).json({
      amount: null,
      effectiveAmount: null,
      discountLabel: null,
      currency: "usd",
      hasAIUpgrade: !!(user as any).hasAI,
      adminView: (user as any)?.role === "admin",
    });
  }

  try {
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      expand: [
        "data.items.data.price",
        // support both legacy single discount and new array form
        "data.discount.coupon",
        "data.discounts.data.coupon",
      ],
      limit: 100,
    });

    let monthlyCentsTotal = 0;
    let effectiveMonthlyCentsTotal = 0;
    let anyDiscountLabel: string | null = null;
    let anyCurrency: string | undefined = "usd";
    let hasAI = false;

    for (const sub of subs.data) {
      const isActiveLike =
        sub.status === "active" ||
        sub.status === "trialing" ||
        sub.status === "past_due";

      if (!isActiveLike) continue;

      // Sum recurring item prices on this subscription
      let subCents = 0;
      let subCurrency: string | undefined;

      for (const item of sub.items.data) {
        const price = item.price;
        if (!price) continue;
        if (!subCurrency && price.currency) subCurrency = price.currency;
        if (typeof price.unit_amount === "number") subCents += price.unit_amount;
        if (AI_PRICE_ID && price.id === AI_PRICE_ID) hasAI = true;
      }

      monthlyCentsTotal += subCents;
      if (!anyCurrency && subCurrency) anyCurrency = subCurrency;

      // ---- Discount (support both shapes) ----
      let discounted = subCents;

      // Shape A: subscription.discount?.coupon
      const singleCoupon = (sub as any)?.discount?.coupon;

      // Shape B: subscription.discounts?.data?.[0]?.coupon
      const arrayCoupon =
        (sub as any)?.discounts?.data?.[0]?.coupon ||
        null;

      const coupon = singleCoupon || arrayCoupon || null;

      if (coupon) {
        const percent = typeof coupon.percent_off === "number" ? coupon.percent_off : null;
        const amountOff = typeof coupon.amount_off === "number" ? coupon.amount_off : null;

        if (percent && percent > 0) {
          discounted = Math.max(0, Math.round(subCents * (1 - percent / 100)));
        } else if (amountOff && amountOff > 0) {
          discounted = Math.max(0, subCents - amountOff);
        }

        anyDiscountLabel =
          coupon.name ||
          (percent != null
            ? `${percent}% off`
            : amountOff != null
            ? `$${(amountOff / 100).toFixed(0)} off`
            : "Discount");
      }

      effectiveMonthlyCentsTotal += discounted;
    }

    const hasAIUpgrade = hasAI || !!(user as any).hasAI;

    const amount =
      monthlyCentsTotal > 0 ? Math.round(monthlyCentsTotal) / 100 : null;

    const effectiveAmount =
      effectiveMonthlyCentsTotal > 0
        ? Math.round(effectiveMonthlyCentsTotal) / 100
        : amount;

    return res.status(200).json({
      amount,
      effectiveAmount,
      discountLabel: anyDiscountLabel,
      currency: (anyCurrency || "usd").toLowerCase(),
      hasAIUpgrade,
      adminView: (user as any)?.role === "admin",
    });
  } catch (err: any) {
    console.error("get-subscription error:", err?.message || err);
    return res.status(200).json({
      amount: null,
      effectiveAmount: null,
      discountLabel: null,
      currency: "usd",
      hasAIUpgrade: !!(user as any).hasAI,
      adminView: (user as any)?.role === "admin",
    });
  }
}
