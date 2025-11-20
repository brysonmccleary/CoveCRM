// /pages/api/stripe/get-subscription.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

// Base CRM price (monthly)
// This should match what you use in /api/create-subscription
const BASE_PRICE_ID =
  process.env.STRIPE_PRICE_ID_MONTHLY || process.env.STRIPE_PRICE_ID || "";

// AI add-on price (monthly)
// Support both the old and new env names just in case
const AI_PRICE_ID =
  process.env.STRIPE_PRICE_ID_AI_MONTHLY ||
  process.env.STRIPE_PRICE_ID_AI_ADDON ||
  "";

// Helper to decide if a subscription should be considered "active-ish"
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

  // If they somehow don't have a Stripe customer yet, fall back to user.hasAI only
  if (!user.stripeCustomerId) {
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }

  try {
    // Get all subscriptions for this customer with expanded prices + coupon
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      expand: ["data.items.data.price", "data.discount.coupon"],
      limit: 10,
    });

    // Filter to active-ish subs
    const activeSubs = subs.data.filter((s) => isActiveLike(s.status));
    if (!activeSubs.length) {
      return res.status(200).json({
        amount: null,
        hasAIUpgrade: !!(user as any).hasAI,
      });
    }

    // Prefer the sub that contains the base CRM price
    let sub: Stripe.Subscription = activeSubs[0];
    if (BASE_PRICE_ID) {
      const withBase = activeSubs.find((s) =>
        s.items.data.some((item) => item.price?.id === BASE_PRICE_ID),
      );
      if (withBase) sub = withBase;
    }

    // Separate base vs AI line items so we can apply discounts correctly
    let baseCents = 0;
    let aiCents = 0;
    let hasAIOnSub = false;

    for (const item of sub.items.data) {
      const price = item.price;
      const unit = price?.unit_amount ?? 0;
      const qty = item.quantity ?? 1;
      const lineTotal = unit * qty;

      if (!unit) continue;

      if (BASE_PRICE_ID && price?.id === BASE_PRICE_ID) {
        baseCents += lineTotal;
      } else if (AI_PRICE_ID && price?.id === AI_PRICE_ID) {
        aiCents += lineTotal;
        hasAIOnSub = true;
      } else {
        // Ignore unrelated subscriptions like phone number $2 plans
      }
    }

    // If we somehow didn't see either base or AI, just fall back to old behavior
    if (!baseCents && !aiCents) {
      const monthlyCents = sub.items.data.reduce((sum, item) => {
        const unit = item.price?.unit_amount ?? 0;
        const qty = item.quantity ?? 1;
        return sum + unit * qty;
      }, 0);

      return res.status(200).json({
        amount: monthlyCents ? (monthlyCents / 100).toFixed(2) : null,
        hasAIUpgrade: hasAIOnSub || !!(user as any).hasAI,
      });
    }

    // Apply subscription discount ONLY to the base CRM portion.
    // This matches your desired behavior:
    // - $50 off → 199.99 → 149.99 (base) + AI (if enabled)
    // - 100% off → base becomes 0, AI still charged at full $50, etc.
    let discountedBaseCents = baseCents;

    // Use `any` to avoid TS complaining about `discount`
    const coupon = (sub as any).discount?.coupon as
      | Stripe.Coupon
      | undefined;

    if (coupon) {
      if (coupon.amount_off) {
        discountedBaseCents = Math.max(0, baseCents - coupon.amount_off);
      } else if (coupon.percent_off) {
        const factor = 1 - coupon.percent_off / 100;
        discountedBaseCents = Math.max(
          0,
          Math.round(baseCents * factor),
        );
      }
    }

    const effectiveTotalCents = discountedBaseCents + aiCents;
    const amount =
      effectiveTotalCents > 0
        ? (effectiveTotalCents / 100).toFixed(2)
        : "0.00";

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
