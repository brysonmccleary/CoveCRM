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

  // IMPORTANT: support both legacy stripeCustomerID and new stripeCustomerId
  const stripeCustomerId =
    (user as any).stripeCustomerId ||
    (user as any).stripeCustomerID ||
    null;

  console.log("[get-subscription] user", {
    email: user.email,
    stripeCustomerId,
    hasStripeCustomerIdField: !!(user as any).stripeCustomerId,
    hasLegacyStripeCustomerIDField: !!(user as any).stripeCustomerID,
    BASE_PRICE_ID,
    AI_PRICE_ID,
  });

  // If we don’t even know their Stripe customer, just say “no CRM billing yet”
  if (!stripeCustomerId || !BASE_PRICE_ID) {
    console.log("[get-subscription] early-exit: missing customer or base price", {
      stripeCustomerId,
      BASE_PRICE_ID,
    });
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }

  try {
    // First, resolve the product behind the base CRM price.
    // This lets us recognize legacy prices that share the same product.
    const basePrice = (await stripe.prices.retrieve(
      BASE_PRICE_ID
    )) as Stripe.Price;
    const baseProductId =
      (basePrice.product as string | null | undefined) || null;

    console.log("[get-subscription] base price resolved", {
      BASE_PRICE_ID,
      baseProductId,
      baseUnitAmount: basePrice.unit_amount,
    });

    // Grab all subscriptions for the customer.
    // Expand:
    // - price on items to know which item is CRM vs AI
    // - coupon on discounts so we can see amount_off / percent_off
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      expand: ["data.items.data.price", "data.discounts.data.coupon"],
    });

    console.log("[get-subscription] subscriptions fetched", {
      count: subs.data.length,
      ids: subs.data.map((s) => ({ id: s.id, status: s.status })),
    });

    let crmAmountCents: number | null = null;
    let hasAI = false;

    for (const sub of subs.data as Stripe.Subscription[]) {
      const isActiveLike =
        sub.status === "active" || sub.status === "trialing";
      if (!isActiveLike) continue;

      const items = sub.items.data as Stripe.SubscriptionItem[];

      // Pre-log items for this subscription
      const itemSummary = items.map((it) => {
        const price = it.price as Stripe.Price | null | undefined;
        return {
          priceId: price?.id,
          productId: price?.product || null,
          unitAmount: price?.unit_amount,
        };
      });

      console.log("[get-subscription] inspecting subscription", {
        subscriptionId: sub.id,
        status: sub.status,
        itemSummary,
      });

      // Check if this subscription has the AI add-on price.
      if (AI_PRICE_ID) {
        const hasAiItem = items.some(
          (it) => it.price && it.price.id === AI_PRICE_ID
        );
        if (hasAiItem) {
          hasAI = true;
        }
      }

      // Look for the CRM base item on this subscription.
      // We treat an item as CRM if:
      //   - its price.id matches BASE_PRICE_ID  OR
      //   - its price.product matches the base product (legacy price support)
      const crmItem = items.find((it) => {
        const price = it.price as Stripe.Price | null | undefined;
        if (!price) return false;
        const productId = price.product as string | null | undefined;
        return (
          price.id === BASE_PRICE_ID ||
          (!!baseProductId && !!productId && productId === baseProductId)
        );
      });

      if (!crmItem) {
        console.log("[get-subscription] no CRM item on this subscription", {
          subscriptionId: sub.id,
        });
        // No CRM item here; this is probably a phone-number-only or other add-on
        continue;
      }

      // If we've already found a CRM subscription and computed a price,
      // keep the first one we saw and just continue scanning other subs
      // for AI add-ons only.
      if (crmAmountCents !== null) {
        console.log(
          "[get-subscription] CRM amount already set, skipping price update",
          {
            subscriptionId: sub.id,
            existingCrmAmountCents: crmAmountCents,
          }
        );
        continue;
      }

      // Start from the CRM base unit amount in cents.
      let baseCents = crmItem.price?.unit_amount ?? 0;

      // Use subscription.discounts (plural), which is what your
      // create-subscription API populates via params.discounts.
      const discountsList = (sub as any).discounts as
        | Stripe.ApiList<Stripe.Discount>
        | undefined;

      let coupon: Stripe.Coupon | null = null;

      if (discountsList && discountsList.data && discountsList.data.length > 0) {
        const firstDiscount = discountsList.data[0];
        const rawCoupon = firstDiscount.coupon as Stripe.Coupon | string;

        // If coupon is expanded, we can use it directly
        if (typeof rawCoupon !== "string") {
          coupon = rawCoupon as Stripe.Coupon;
        }
      }

      console.log("[get-subscription] CRM item found", {
        subscriptionId: sub.id,
        crmPriceId: crmItem.price?.id,
        crmProductId: crmItem.price?.product || null,
        crmBaseUnitAmount: crmItem.price?.unit_amount,
        hasDiscountsList: !!discountsList,
        couponSummary: coupon
          ? {
              id: coupon.id,
              amount_off: coupon.amount_off,
              percent_off: coupon.percent_off,
            }
          : null,
      });

      // Apply coupon to CRM base amount if present
      if (coupon) {
        if (coupon.amount_off) {
          baseCents = Math.max(baseCents - coupon.amount_off, 0);
        } else if (coupon.percent_off) {
          const pct = coupon.percent_off / 100;
          baseCents = Math.round(baseCents * (1 - pct));
        }
      }

      crmAmountCents = baseCents;

      console.log("[get-subscription] computed CRM amount", {
        subscriptionId: sub.id,
        crmAmountCents,
      });
    }

    // If we never found a CRM subscription at all, treat as "no active CRM plan".
    if (crmAmountCents === null) {
      console.log("[get-subscription] no CRM subscription found at all", {
        stripeCustomerId,
      });
      return res.status(200).json({
        amount: null,
        hasAIUpgrade: hasAI || !!(user as any).hasAI,
      });
    }

    // Convert cents → dollars with 2 decimal places.
    const amountNumber = Number((crmAmountCents / 100).toFixed(2));

    console.log("[get-subscription] final result", {
      amountNumber,
      hasAIUpgrade: hasAI || !!(user as any).hasAI,
    });

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
