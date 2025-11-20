// /pages/api/stripe/get-subscription.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

// Base CRM price (monthly) – same one used in /api/create-subscription
const BASE_PRICE_ID =
  process.env.STRIPE_PRICE_ID_MONTHLY || process.env.STRIPE_PRICE_ID || "";

// AI add-on price (monthly) – support both env names just in case
const AI_PRICE_ID =
  process.env.STRIPE_PRICE_ID_AI_MONTHLY ||
  process.env.STRIPE_PRICE_ID_AI_ADDON ||
  "";

function isActiveLike(status: Stripe.Subscription.Status) {
  return status === "active" || status === "trialing" || status === "past_due";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const email = session.user.email.toLowerCase();
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: "User not found" });

  if (!stripe) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  if (!user.stripeCustomerId) {
    // No billing profile yet – show nothing but preserve AI entitlement flag if set
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }

  try {
    // Grab all subs so we can pick the CRM one (ignore phone-number subs)
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      expand: ["data.items.data.price"],
      limit: 10,
    });

    const activeSubs = subs.data.filter((s) => isActiveLike(s.status));
    if (!activeSubs.length) {
      return res.status(200).json({
        amount: null,
        hasAIUpgrade: !!(user as any).hasAI,
      });
    }

    // Prefer the sub that contains the CRM base price
    let sub: Stripe.Subscription = activeSubs[0];
    if (BASE_PRICE_ID) {
      const withBase = activeSubs.find((s) =>
        s.items.data.some((item) => item.price?.id === BASE_PRICE_ID),
      );
      if (withBase) sub = withBase;
    }

    // Detect whether AI add-on is enabled on THIS sub
    let hasAIOnSub = false;
    for (const item of sub.items.data) {
      const price = item.price;
      if (price?.id && AI_PRICE_ID && price.id === AI_PRICE_ID) {
        hasAIOnSub = true;
      }
    }

    // --- Key part: ask Stripe what they'll actually charge next invoice ---
    let amount: string | null = null;

    try {
      const upcoming = await stripe.invoices.retrieveUpcoming({
        customer: user.stripeCustomerId,
        subscription: sub.id,
      });

      // `total` is the final invoice total, including discounts/coupons
      const totalCents =
        (upcoming.total ?? upcoming.amount_due ?? 0) || 0;

      amount =
        totalCents > 0 ? (totalCents / 100).toFixed(2) : "0.00";
    } catch (invoiceErr) {
      console.warn(
        "get-subscription: retrieveUpcoming failed, falling back to list prices:",
        (invoiceErr as any)?.message || invoiceErr,
      );

      // Fallback: sum the price list on the sub (will show 199.99 if discounts
      // can't be read – better than crashing)
      const monthlyCents = sub.items.data.reduce((sum, item) => {
        const unit = item.price?.unit_amount ?? 0;
        const qty = item.quantity ?? 1;
        return sum + unit * qty;
      }, 0);

      amount = monthlyCents ? (monthlyCents / 100).toFixed(2) : null;
    }

    return res.status(200).json({
      amount,
      hasAIUpgrade: hasAIOnSub || !!(user as any).hasAI,
    });
  } catch (err: any) {
    console.error("get-subscription error:", err?.message || err);
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }
}
