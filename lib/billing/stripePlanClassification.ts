type StripeItemLike = { price?: { id?: string | null } | null };

export type StripeSubscriptionLike = {
  status?: string | null;
  metadata?: Record<string, string> | null;
  items?: { data?: StripeItemLike[] | null } | null;
};

const DEFAULT_LEGACY_CRM_PRICE_ID = "price_1RoAGJDF9aEsjVyJV2wARrFp";
const DEFAULT_PHONE_PRICE_ID = "price_1TkCtfDF9aEsjVyJRrUfYdLF";
const DEFAULT_LEGACY_PHONE_PRICE_ID = "price_1RpvR9DF9aEsjVyJk9GiJkpe";

function csv(value?: string | null): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
export function crmPlanPriceIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set([
    env.CoveCRM_Base,
    env.CoveCRM_Annual_Base_Plan,
    env.CoveCRM_AI_Plan,
    env.CoveCRM_AI_Annual_Plan,
    env.STRIPE_PRICE_ID_MONTHLY,
    env.STRIPE_PRICE_ID_ANNUAL,
    env.STRIPE_PRICE_ID_AI_MONTHLY,
    ...csv(env.LEGACY_AI_GRANDFATHER_PRICE_IDS || DEFAULT_LEGACY_CRM_PRICE_ID),
  ].filter((value): value is string => Boolean(value)));
}

export function phonePriceIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set([
    env.STRIPE_PHONE_PRICE_ID,
    DEFAULT_PHONE_PRICE_ID,
    DEFAULT_LEGACY_PHONE_PRICE_ID,
    ...csv(env.STRIPE_LEGACY_PHONE_PRICE_IDS),
  ].filter((value): value is string => Boolean(value)));
}

export function isPhoneNumberSubscription(
  subscription: StripeSubscriptionLike,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const purpose = String(subscription.metadata?.purpose || "").toLowerCase();
  const phoneBilling = String(subscription.metadata?.phoneBilling || "").toLowerCase();
  if (purpose === "phone_number" || phoneBilling === "true") return true;

  const phoneIds = phonePriceIds(env);
  const items = subscription.items?.data || [];
  return items.length > 0 && items.every((item) => phoneIds.has(String(item.price?.id || "")));
}

export function findActiveCrmPlanSubscription<T extends StripeSubscriptionLike>(
  subscriptions: T[],
  env: NodeJS.ProcessEnv = process.env,
): T | undefined {
  const activeStatuses = new Set(["active", "trialing", "past_due", "incomplete"]);
  const planIds = crmPlanPriceIds(env);

  return subscriptions.find((subscription) => {
    if (!activeStatuses.has(String(subscription.status || ""))) return false;
    if (isPhoneNumberSubscription(subscription, env)) return false;
    return (subscription.items?.data || []).some((item) => planIds.has(String(item.price?.id || "")));
  });
}
