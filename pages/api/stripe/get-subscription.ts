// /pages/api/stripe/get-subscription.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

// Base CRM plan price (required)
const BASE_PRICE_ID = process.env.STRIPE_PRICE_ID_MONTHLY || "";

// Support BOTH legacy AI price and new add-on price
const AI_PRICE_ID_LEGACY = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "";
const AI_PRICE_ID_ADDON = process.env.STRIPE_PRICE_ID_AI_ADDON || "";

// Helper: set of AI price IDs to check against
const AI_PRICE_IDS = [AI_PRICE_ID_LEGACY, AI_PRICE_ID_ADDON].filter(Boolean);

function isAiPriceId(id?: string | null): boolean {
  if (!id) return false;
  return AI_PRICE_IDS.includes(id);
}

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
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }

  if (!user.stripeCustomerId) {
    // No Stripe customer yet → show loading / unknown
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
    let hasAI = false;

    for (const sub of subs.data) {
      const status = sub.status;
      const activeLike =
        status === "active" || status === "trialing" || status === "past_due";
      if (!activeLike) continue;

      // Only consider subscriptions that include our base plan or AI prices
      const hasRelevantItem = sub.items.data.some((item) => {
        const price = item.price;
        if (!price) return false;
        return price.id === BASE_PRICE_ID || isAiPriceId(price.id);
      });

      if (!hasRelevantItem) continue;

      let subTotalCents: number | null = null;

      // --- PRIMARY PATH: use upcoming invoice amount_due / total (already discounted) ---
      try {
        const invoicesApi: any = stripe.invoices; // cast to any so we can call retrieveUpcoming safely
        const upcoming: Stripe.UpcomingInvoice | any =
          await invoicesApi.retrieveUpcoming({
            customer: user.stripeCustomerId,
            subscription: sub.id,
          });

        if (upcoming) {
          const amountDue = typeof upcoming.amount_due === "number"
            ? upcoming.amount_due
            : typeof upcoming.total === "number"
            ? upcoming.total
            : null;

          if (amountDue !== null) {
            subTotalCents = amountDue;
          }
        }
      } catch (e) {
        console.warn(
          "get-subscription: upcoming invoice lookup failed for sub",
          sub.id,
          e
        );
      }

      // --- FALLBACK: if we couldn't get upcoming invoice, sum raw price amounts (no discounts) ---
      if (subTotalCents === null) {
        let fallback = 0;

        for (const item of sub.items.data) {
          const price = item.price;
          if (!price || typeof price.unit_amount !== "number") continue;
          const qty = item.quantity ?? 1;

          if (price.id === BASE_PRICE_ID || isAiPriceId(price.id)) {
            fallback += price.unit_amount * qty;
          }
        }

        subTotalCents = fallback;
      }

      // Track AI flag based on subscription items
      if (!hasAI) {
        hasAI = sub.items.data.some((item) =>
          isAiPriceId(item.price?.id || "")
        );
      }

      if (subTotalCents && subTotalCents > 0) {
        totalCents += subTotalCents;
      }
    }

    // If nothing found, treat CRM as $0 (e.g., fully comped) instead of null.
    const amount =
      totalCents > 0 ? Number((totalCents / 100).toFixed(2)) : 0;

    return res.status(200).json({
      amount,
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
