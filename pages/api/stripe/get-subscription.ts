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

export default async function handler(req: NextApiRequest, res: NextApiResponse<Out | { error: string }>) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const AI_PRICE_ID = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "";

  // If no Stripe customer yet, return entitlement from db (if any)
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
    // Pull all subscriptions. We’ll aggregate only active-like statuses.
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      expand: [
        "data.items.data.price",
        "data.discount.coupon",   // so we can read percent_off/amount_off
      ],
      limit: 100,
    });

    let monthlyCentsTotal = 0;         // pre-discount
    let effectiveMonthlyCentsTotal = 0; // after discounts per-sub
    let anyDiscountLabel: string | null = null;
    let anyCurrency: string | undefined = "usd";
    let hasAI = false;

    for (const sub of subs.data) {
      const isActiveLike =
        sub.status === "active" ||
        sub.status === "trialing" ||
        sub.status === "past_due";

      if (!isActiveLike) continue;

      // Sum this subscription’s recurring item prices (unit_amount). Ignore metered that report as null.
      let subCents = 0;
      let subCurrency: string | undefined;
      for (const item of sub.items.data) {
        const price = item.price;
        if (!price) continue;
        // Track currency if present (assume all items in a sub share currency).
        if (!subCurrency && price.currency) subCurrency = price.currency;
        if (typeof price.unit_amount === "number") {
          subCents += price.unit_amount;
        }
        if (AI_PRICE_ID && price.id === AI_PRICE_ID) hasAI = true;
      }

      // Base totals
      monthlyCentsTotal += subCents;
      if (!anyCurrency && subCurrency) anyCurrency = subCurrency;

      // Apply subscription-level discount if present
      let discounted = subCents;
      const c = sub.discount?.coupon || null;
      if (c) {
        // percent_off takes precedence if provided; else amount_off
        if (typeof c.percent_off === "number" && c.percent_off > 0) {
          discounted = Math.max(0, Math.round(subCents * (1 - c.percent_off / 100)));
        } else if (typeof c.amount_off === "number" && c.amount_off > 0) {
          discounted = Math.max(0, subCents - c.amount_off);
        }
        // Prefer a human-friendly name if available, else construct one.
        anyDiscountLabel =
          c.name ||
          (typeof c.percent_off === "number"
            ? `${c.percent_off}% off`
            : typeof c.amount_off === "number"
            ? `$${(c.amount_off / 100).toFixed(0)} off`
            : "Discount");
      }

      effectiveMonthlyCentsTotal += discounted;
    }

    // Fallback to legacy flag if no active AI price line found
    const hasAIUpgrade = hasAI || !!(user as any).hasAI;

    const amount =
      monthlyCentsTotal > 0 ? Math.round(monthlyCentsTotal) / 100 : null;

    const effectiveAmount =
      effectiveMonthlyCentsTotal > 0 ? Math.round(effectiveMonthlyCentsTotal) / 100 : amount;

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
