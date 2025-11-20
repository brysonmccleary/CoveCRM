// /pages/api/stripe/get-subscription.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

const BASE_PRICE_ID = process.env.STRIPE_PRICE_ID_MONTHLY || "";
// AI price can be either env – use whatever you actually use in Stripe
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

  // If we don’t even know their Stripe customer, just say “no CRM billing yet”
  if (!user.stripeCustomerId || !BASE_PRICE_ID) {
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }

  try {
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      expand: ["data.items.data.price"],
    });

    let totalCents = 0;
    let sawCrmOrAi = false;
    let hasAI = false;

    for (const sub of subs.data) {
      const status = sub.status;
      const activeLike =
        status === "active" || status === "trialing" || status === "past_due";
      if (!activeLike) continue;

      const items = sub.items.data;

      // Identify the CRM base and AI add-on items on THIS subscription
      const baseItem = items.find((it) => it.price?.id === BASE_PRICE_ID);
      const aiItem =
        AI_PRICE_ID && items.find((it) => it.price?.id === AI_PRICE_ID);

      // If this subscription has neither CRM base nor AI add-on, it’s probably
      // just phone-number billing → ignore for the main plan display.
      if (!baseItem && !aiItem) continue;

      sawCrmOrAi = true;

      let baseCents = baseItem?.price?.unit_amount ?? 0;
      let aiCents = aiItem?.price?.unit_amount ?? 0;

      // Apply any coupon on the subscription to the BASE amount only
      const rawDiscount: any = (sub as any).discount;
      const coupon = rawDiscount?.coupon as Stripe.Coupon | undefined;

      if (coupon) {
        if (coupon.amount_off) {
          // flat $ off → subtract from base only
          baseCents = Math.max(baseCents - coupon.amount_off, 0);
        } else if (coupon.percent_off) {
          // % off → apply to base only
          const pct = coupon.percent_off / 100;
          baseCents = Math.round(baseCents * (1 - pct));
        }
      }

      totalCents += baseCents + aiCents;
      if (aiItem) hasAI = true;
    }

    // If we never saw a CRM or AI item, they truly don’t have a CRM subscription
    if (!sawCrmOrAi) {
      return res.status(200).json({
        amount: null,
        hasAIUpgrade: !!(user as any).hasAI,
      });
    }

    // totalCents can legitimately be 0 (e.g. free CRM with 100% coupon).
    const amountNumber = Number((totalCents / 100).toFixed(2));

    return res.status(200).json({
      amount: amountNumber, // e.g. 0, 149.99, 199.99, etc.
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
