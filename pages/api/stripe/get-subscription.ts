// /pages/api/stripe/get-subscription.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

const BASE_PRICE_ID = process.env.STRIPE_PRICE_ID_MONTHLY || "";
// IMPORTANT: use the SAME env var name as create-subscription
const AI_PRICE_ID = process.env.STRIPE_PRICE_ID_AI_ADDON || "";

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
  if (!user) return res.status(404).json({ error: "User not found" });

  if (!stripe) {
    console.error("Stripe client missing");
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!user.hasAI,
    });
  }

  if (!user.stripeCustomerId) {
    // No Stripe profile yet → show “Loading / $…”
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!user.hasAI,
    });
  }

  try {
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      expand: ["data.items.data.price"],
    });

    let totalCents = 0;
    let hasAI = false;

    for (const sub of subs.data) {
      const status = sub.status;
      const activeLike =
        status === "active" || status === "trialing" || status === "past_due";
      if (!activeLike) continue;

      // Only consider subs that actually have the base or AI prices
      const hasRelevantItem = sub.items.data.some((item) => {
        const price = item.price;
        if (!price) return false;
        return price.id === BASE_PRICE_ID || price.id === AI_PRICE_ID;
      });

      if (!hasRelevantItem) continue;

      let subSubtotalCents: number | null = null;

      // --- Primary path: use upcoming invoice subtotal (already includes discounts) ---
      try {
        const invoicesApi: any = stripe.invoices; // cast to any to safely call retrieveUpcoming
        const upcoming = await invoicesApi.retrieveUpcoming({
          customer: user.stripeCustomerId,
          subscription: sub.id,
          expand: ["lines.data.price"],
        });

        if (upcoming && upcoming.lines && Array.isArray(upcoming.lines.data)) {
          let subtotal = 0;

          for (const line of upcoming.lines.data as any[]) {
            const price = line.price as Stripe.Price | null;
            if (!price || typeof price.unit_amount !== "number") continue;

            if (price.id === BASE_PRICE_ID || price.id === AI_PRICE_ID) {
              const quantity =
                typeof line.quantity === "number" ? line.quantity : 1;
              // line.amount is already discount-adjusted; fall back to unit_amount * quantity
              const lineAmount =
                typeof line.amount === "number"
                  ? line.amount
                  : price.unit_amount * quantity;

              subtotal += lineAmount;

              if (price.id === AI_PRICE_ID) {
                hasAI = true;
              }
            }
          }

          subSubtotalCents = subtotal;
        }
      } catch (e) {
        console.warn(
          "get-subscription: upcoming invoice lookup failed for sub",
          sub.id,
          e
        );
      }

      // --- Fallback path: no upcoming invoice → sum raw price amounts (no discounts) ---
      if (subSubtotalCents === null) {
        let fallbackSubtotal = 0;

        for (const item of sub.items.data) {
          const price = item.price;
          if (!price || typeof price.unit_amount !== "number") continue;
          const qty = item.quantity ?? 1;

          if (price.id === BASE_PRICE_ID || price.id === AI_PRICE_ID) {
            fallbackSubtotal += price.unit_amount * qty;
            if (price.id === AI_PRICE_ID) hasAI = true;
          }
        }

        subSubtotalCents = fallbackSubtotal;
      }

      if (subSubtotalCents && subSubtotalCents > 0) {
        totalCents += subSubtotalCents;
      }
    }

    const amount =
      totalCents > 0 ? Number((totalCents / 100).toFixed(2)) : 0;

    return res.status(200).json({
      amount,
      hasAIUpgrade: hasAI || !!user.hasAI,
    });
  } catch (err: any) {
    console.error("get-subscription error:", err?.message || err);
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!user.hasAI,
    });
  }
}
