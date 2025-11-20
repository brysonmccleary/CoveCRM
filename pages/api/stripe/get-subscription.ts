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

  // Support both legacy stripeCustomerID and new stripeCustomerId
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
    // Resolve the base CRM price → get its product id so we can match legacy prices.
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

    // Fetch all subs, only expanding prices.
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      expand: ["data.items.data.price"],
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

      // Detect AI add-on
      if (AI_PRICE_ID) {
        const hasAiItem = items.some(
          (it) => it.price && it.price.id === AI_PRICE_ID
        );
        if (hasAiItem) {
          hasAI = true;
        }
      }

      // Find CRM item on this sub by price ID or product match
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
        continue;
      }

      // If we've already set a CRM amount, don't overwrite it (but still track AI above).
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

      // --- Primary path: use upcoming invoice line amount (after discounts) ---
      let effectiveCents: number | null = null;

      try {
        const invoicesAny = (stripe.invoices as unknown) as {
          retrieveUpcoming: (params: any) => Promise<Stripe.Invoice>;
        };

        const upcoming = await invoicesAny.retrieveUpcoming({
          customer: stripeCustomerId,
          subscription: sub.id,
          expand: ["lines.data.price"],
        });

        const crmLine = upcoming.lines.data.find((line) => {
          const price = (line as any).price as Stripe.Price | undefined;
          if (!price) return false;
          const productId = price.product as string | null | undefined;
          return (
            price.id === BASE_PRICE_ID ||
            (!!baseProductId && !!productId && productId === baseProductId)
          );
        });

        if (crmLine) {
          // Stripe invoices store line.amount in cents, after discounts.
          effectiveCents =
            typeof crmLine.amount === "number" ? crmLine.amount : null;
          console.log("[get-subscription] upcoming invoice CRM line", {
            subscriptionId: sub.id,
            lineAmount: crmLine.amount,
          });
        } else {
          console.log(
            "[get-subscription] no matching CRM line on upcoming invoice",
            { subscriptionId: sub.id }
          );
        }
      } catch (e: any) {
        console.error(
          "[get-subscription] retrieveUpcoming failed (will fall back to base amount)",
          e?.message || e
        );
        effectiveCents = null;
      }

      // --- Fallback: use base unit amount (no discount logic) ---
      if (effectiveCents === null) {
        const baseCents = crmItem.price?.unit_amount ?? 0;
        console.log("[get-subscription] fallback to base unit amount", {
          subscriptionId: sub.id,
          baseCents,
        });
        effectiveCents = baseCents;
      }

      crmAmountCents = effectiveCents;

      console.log("[get-subscription] computed CRM amount", {
        subscriptionId: sub.id,
        crmAmountCents,
      });
    }

    if (crmAmountCents === null) {
      console.log("[get-subscription] no CRM subscription found at all", {
        stripeCustomerId,
      });
      return res.status(200).json({
        amount: null,
        hasAIUpgrade: hasAI || !!(user as any).hasAI,
      });
    }

    const amountNumber = Number((crmAmountCents / 100).toFixed(2));

    console.log("[get-subscription] final result", {
      amountNumber,
      hasAIUpgrade: hasAI || !!(user as any).hasAI,
    });

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
