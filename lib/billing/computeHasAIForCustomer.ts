import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

// All Stripe price IDs that represent a paid AI entitlement — the $150/mo
// combined AI plan, its annual equivalent, or the $50/mo add-on that brings a
// $100 base plan up to the same $150 total. Two historical env-var naming
// schemes exist for this (STRIPE_PRICE_ID_AI_MONTHLY predates AI_Upgrade/
// CoveCRM_AI_Plan/CoveCRM_AI_Annual_Plan by ~300 days); check all of them so a
// customer on either scheme is recognized.
const AI_PRICE_IDS: string[] = [
  process.env.STRIPE_PRICE_ID_AI_MONTHLY,
  process.env.AI_Upgrade,
  process.env.CoveCRM_AI_Plan,
  process.env.CoveCRM_AI_Annual_Plan,
]
  .map((v) => (v || "").trim())
  .filter(Boolean);

/**
 * Live-checks whether a Stripe customer currently has a paid AI item
 * (the $150 combined plan, its annual equivalent, or the $50 upgrade
 * add-on) on any active/trialing subscription.
 */
export async function computeHasAIForCustomer(
  customerId: string,
  auditLog?: (msg: string, extra?: Record<string, unknown>) => void,
): Promise<boolean> {
  if (!customerId || AI_PRICE_IDS.length === 0) return false;

  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      expand: ["data.items.data.price"],
      limit: 100,
    });

    for (const sub of subs.data as Stripe.Subscription[]) {
      const activeLike = sub.status === "active" || sub.status === "trialing";
      if (!activeLike) continue;

      const items = sub.items?.data || [];
      const hasAiOnThisSub = items.some((it: any) => AI_PRICE_IDS.includes(it?.price?.id));
      if (hasAiOnThisSub) return true;
    }

    return false;
  } catch (e: any) {
    auditLog?.("computeHasAIForCustomer failed", {
      customerId,
      message: e?.message || String(e),
    });
    return false;
  }
}

export { AI_PRICE_IDS };
