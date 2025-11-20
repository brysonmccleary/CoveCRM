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
    // Grab all subscriptions for the customer.
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      expand: ["data.items.data.price"],
    });

    let crmAmountCents: number | null = null;
    let hasAI = false;

    for (const sub of subs.data as Stripe.Subscription[]) {
      // Only consider active / trialing subs as "current"
      const isActiveLike =
        sub.status === "active" || sub.status === "trialing";
      if (!isActiveLike) continue;

      const items = sub.items.data as Stripe.SubscriptionItem[];

      // Check if this subscription has the AI add-on price.
      if (AI_PRICE_ID) {
        const hasAiItem = items.some(
          (it) => it.price && it.price.id === AI_PRICE_ID
        );
        if (hasAiItem) {
          hasAI = true;
        }
      }

      // Look for the CRM base price item on this subscription
      const crmItem = items.find(
        (it) => it.price && it.price.id === BASE_PRICE_ID
      );
      if (!crmItem) {
        // No CRM item here; this is probably a phone-number-only or other add-on
        // subscription. Ignore it for the main CRM plan price.
        continue;
      }

      // If we've already found a CRM subscription and computed a price,
      // keep the first one we saw and just continue scanning other subs
      // for AI add-ons.
      if (crmAmountCents !== null) {
        continue;
      }

      // --- Primary path: use upcoming invoice line item for CRM base ---
      let effectiveCents: number | null = null;
      try {
        const upcoming = (await stripe.invoices.retrieveUpcoming({
          customer: user.stripeCustomerId,
          subscription: sub.id,
          expand: ["lines.data.price"],
        })) as Stripe.Invoice;

        const crmLine = upcoming.lines.data.find((line) => {
          const price = (line as any).price as Stripe.Price | undefined;
          return price && price.id === BASE_PRICE_ID;
        });

        if (crmLine) {
          // This amount is the discounted line amount in cents (can be 0)
          effectiveCents = crmLine.amount ?? null;
        }
      } catch (e) {
        // If retrieveUpcoming fails for any reason, we'll fall back
        // to the subscription + coupon logic below.
        effectiveCents = null;
      }

      // --- Fallback path: compute from unit_amount + subscription discount ---
      if (effectiveCents === null) {
        let baseCents = crmItem.price?.unit_amount ?? 0;

        const discount = (sub as any).discount as
          | Stripe.Discount
          | null
          | undefined;

        if (discount && discount.coupon) {
          const rawCoupon = discount.coupon as Stripe.Coupon | string;
          const coupon =
            typeof rawCoupon === "string" ? null : (rawCoupon as Stripe.Coupon);

          if (coupon) {
            if (coupon.amount_off) {
              // Flat amount off (in cents) – subtract from base only, clamp at 0
              baseCents = Math.max(baseCents - coupon.amount_off, 0);
            } else if (coupon.percent_off) {
              // Percentage off – apply to base amount
              const pct = coupon.percent_off / 100;
              baseCents = Math.round(baseCents * (1 - pct));
            }
          }
        }

        effectiveCents = baseCents;
      }

      // This is the effective CRM amount for this user in cents.
      crmAmountCents = effectiveCents;
    }

    // If we never found a CRM subscription at all, treat as "no active CRM plan".
    if (crmAmountCents === null) {
      return res.status(200).json({
        amount: null,
        hasAIUpgrade: hasAI || !!(user as any).hasAI,
      });
    }

    // Convert cents → dollars with 2 decimal places.
    const amountNumber = Number((crmAmountCents / 100).toFixed(2));

    return res.status(200).json({
      // e.g. 0, 149.99, 199.99, etc.
      amount: amountNumber,
      hasAIUpgrade: hasAI || !!(user as any).hasAI,
    });
  } catch (err: any) {
    console.error("get-subscription error:", err?.message || err);
    // On error, fall back to "no price yet" but keep AI flag if we have it on the user.
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }
}
