// /pages/api/stripe/get-subscription.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

type PlanCode = "free" | "base" | "ai";
type BillingInterval = "monthly" | "annual";

const PRICE_MAP: Record<string, { planCode: PlanCode; billingInterval: BillingInterval; amount: number }> = {
  ...(process.env.CoveCRM_Base
    ? { [process.env.CoveCRM_Base]: { planCode: "base" as const, billingInterval: "monthly" as const, amount: 100 } }
    : {}),
  ...(process.env.CoveCRM_Annual_Base_Plan
    ? { [process.env.CoveCRM_Annual_Base_Plan]: { planCode: "base" as const, billingInterval: "annual" as const, amount: 100 } }
    : {}),
  ...(process.env.CoveCRM_AI_Plan
    ? { [process.env.CoveCRM_AI_Plan]: { planCode: "ai" as const, billingInterval: "monthly" as const, amount: 150 } }
    : {}),
  ...(process.env.CoveCRM_AI_Annual_Plan
    ? { [process.env.CoveCRM_AI_Annual_Plan]: { planCode: "ai" as const, billingInterval: "annual" as const, amount: 150 } }
    : {}),
  ...(process.env.AI_Upgrade
    ? { [process.env.AI_Upgrade]: { planCode: "base" as const, billingInterval: "monthly" as const, amount: 50 } }
    : {}),
};

function legacyPlanCode(user: any): PlanCode {
  if (user?.planCode === "base" || user?.planCode === "ai" || user?.planCode === "free") return user.planCode;
  return "free";
}

function legacyBillingInterval(user: any): BillingInterval {
  return user?.billingInterval === "annual" ? "annual" : "monthly";
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
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const stripeCustomerId =
    (user as any).stripeCustomerId ||
    (user as any).stripeCustomerID ||
    null;

  if (!stripeCustomerId) {
    return res.status(200).json({
      planCode: legacyPlanCode(user),
      billingInterval: legacyBillingInterval(user),
      amount: (user as any).planCode === "ai" || (user as any).hasAI ? 150 : null,
      nextBillingDate: null,
      status: (user as any).subscriptionStatus || null,
      trialEnd: (user as any).trialEndsAt || null,
      cancelAtPeriodEnd: false,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }

  try {
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      limit: 10,
      expand: ["data.items.data.price"],
    });

    const activeLike = subs.data.find((sub) =>
      ["active", "trialing", "past_due", "incomplete"].includes(sub.status)
    );

    if (!activeLike) {
      return res.status(200).json({
        planCode: legacyPlanCode(user),
        billingInterval: legacyBillingInterval(user),
        amount: null,
        nextBillingDate: null,
        status: (user as any).subscriptionStatus || null,
        trialEnd: (user as any).trialEndsAt || null,
        cancelAtPeriodEnd: false,
        hasAIUpgrade: !!(user as any).hasAI,
      });
    }

    const items = activeLike.items.data as Stripe.SubscriptionItem[];
    let matchedBase: { planCode: PlanCode; billingInterval: BillingInterval; amount: number } | null = null;
    let legacyAmount: number | null = null;
    let hasAIUpgrade = false;

    for (const item of items) {
      const price = item.price as Stripe.Price | null | undefined;
      if (!price?.id) continue;
      const mapped = PRICE_MAP[price.id];
      if (price.id === process.env.AI_Upgrade) hasAIUpgrade = true;

      if (mapped && price.id !== process.env.AI_Upgrade) {
        matchedBase = mapped;
      } else if (!mapped && legacyAmount === null && typeof price.unit_amount === "number") {
        legacyAmount = Number((price.unit_amount / 100).toFixed(2));
      }
    }

    const planCode = matchedBase?.planCode || legacyPlanCode(user);
    const billingInterval = matchedBase?.billingInterval || legacyBillingInterval(user);
    const amount = matchedBase?.amount ?? legacyAmount;

    return res.status(200).json({
      planCode,
      billingInterval,
      amount,
      nextBillingDate: (activeLike as any).current_period_end
        ? new Date((activeLike as any).current_period_end * 1000).toISOString()
        : null,
      status: activeLike.status,
      trialEnd: (activeLike as any).trial_end
        ? new Date((activeLike as any).trial_end * 1000).toISOString()
        : ((user as any).trialEndsAt || null),
      cancelAtPeriodEnd: !!activeLike.cancel_at_period_end,
      hasAIUpgrade: hasAIUpgrade || (user as any).aiEntitlementSource === "upgrade" || !!(user as any).hasAI,
    });
  } catch (err: any) {
    console.error("get-subscription error:", err?.message || err);
    return res.status(200).json({
      planCode: legacyPlanCode(user),
      billingInterval: legacyBillingInterval(user),
      amount: null,
      nextBillingDate: null,
      status: (user as any).subscriptionStatus || null,
      trialEnd: (user as any).trialEndsAt || null,
      cancelAtPeriodEnd: false,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }
}
