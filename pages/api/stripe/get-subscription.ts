// /pages/api/stripe/get-subscription.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

const BASE_PRICE_ID = process.env.STRIPE_PRICE_ID_MONTHLY as string; // main CRM plan
// Try both env names for the AI add-on (use whichever you actually set)
const AI_PRICE_ID =
  process.env.STRIPE_PRICE_ID_AI_MONTHLY ||
  process.env.STRIPE_PRICE_ID_AI_ADDON ||
  "";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // If they don’t even have a Stripe customer yet, show “unknown”
  if (!user.stripeCustomerId) {
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }

  try {
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      expand: [
        "data.items.data.price",
        "data.discount.coupon",
        "data.discounts.data.coupon",
      ],
    });

    let totalCents = 0;
    let hasAI = false;
    let hasAnyRelevantSub = false;

    for (const sub of subs.data) {
      const activeLike =
        sub.status === "active" ||
        sub.status === "trialing" ||
        sub.status === "past_due";

      if (!activeLike) continue;

      let baseCents = 0;
      let aiCents = 0;

      // 1) Identify CRM base + AI prices on this subscription
      for (const item of sub.items.data) {
        const price = item.price;
        if (!price || typeof price.unit_amount !== "number") continue;

        if (BASE_PRICE_ID && price.id === BASE_PRICE_ID) {
          baseCents += price.unit_amount;
        } else if (AI_PRICE_ID && price.id === AI_PRICE_ID) {
          aiCents += price.unit_amount;
          hasAI = true;
        }
      }

      // Skip subs that don't contain our CRM or AI prices at all
      if (!baseCents && !aiCents) continue;

      hasAnyRelevantSub = true;

      let discountedBaseCents = baseCents;

      // 2) Find any coupon attached to this subscription.
      const subAny = sub as any;
      let coupon: Stripe.Coupon | undefined;

      if (subAny.discount?.coupon) {
        coupon = subAny.discount.coupon as Stripe.Coupon;
      } else if (subAny.discounts?.data?.length) {
        const first = subAny.discounts.data[0];
        if (first?.coupon) {
          coupon = first.coupon as Stripe.Coupon;
        }
      }

      if (coupon) {
        const amountOff = (coupon as any).amount_off as number | undefined;
        const percentOff = (coupon as any).percent_off as number | undefined;

        if (amountOff && amountOff > 0) {
          // flat $ off (applied to base only)
          discountedBaseCents = Math.max(baseCents - amountOff, 0);
        } else if (percentOff && percentOff > 0) {
          // percentage off (applied to base only)
          const factor = 1 - percentOff / 100;
          discountedBaseCents = Math.max(
            Math.round(baseCents * factor),
            0
          );
        }
      }

      totalCents += discountedBaseCents + aiCents;

      console.log(
        JSON.stringify({
          msg: "get-subscription summary",
          email: user.email,
          subscriptionId: sub.id,
          status: sub.status,
          baseCents,
          aiCents,
          discountedBaseCents,
          appliedCoupon: coupon
            ? {
                id: coupon.id,
                amount_off: (coupon as any).amount_off || null,
                percent_off: (coupon as any).percent_off || null,
              }
            : null,
        })
      );
    }

    // If there is no CRM/AI sub at all, report null (unknown)
    if (!hasAnyRelevantSub) {
      return res.status(200).json({
        amount: null,
        hasAIUpgrade: !!(user as any).hasAI,
      });
    }

    // Otherwise, return the actual amount, including 0 for fully-discounted plans
    const amountNumber = Number((totalCents / 100).toFixed(2));

    return res.status(200).json({
      amount: amountNumber,
      hasAIUpgrade: hasAI || !!(user as any).hasAI,
    });
  } catch (err: any) {
    console.error("get-subscription error:", err?.message || err);
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }
}
