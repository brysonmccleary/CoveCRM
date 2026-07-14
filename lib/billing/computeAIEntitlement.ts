export type AIEntitlementSource = "plan" | "upgrade" | "legacy" | "grandfathered" | "none";

export type AIEntitlementResult = {
  hasAI: boolean;
  aiEntitlementSource: AIEntitlementSource;
};

export type AIEntitlementUserInput = {
  hasAI?: boolean;
  aiEntitlementSource?: string;
  grandfatheredAI?: boolean;
  planCode?: string;
};

export type AIEntitlementStripeState = {
  hasPaidAIPlanOrUpgrade: boolean;
};

/**
 * Single source of truth for `hasAI`/`aiEntitlementSource`:
 *
 *   hasAI = isAdminFree OR hasPaidAIPlanOrUpgrade OR grandfatheredAI === true
 *
 * `isAdminFreeUser` is resolved by the caller from the existing
 * isAdminFree()/ADMIN_FREE_AI_EMAILS check — kept out of this module so that
 * mechanism is never the *source* of a grandfathered grant, only a
 * pre-existing independent override the formula still has to respect.
 */
export function computeAIEntitlement(
  user: AIEntitlementUserInput,
  stripeState: AIEntitlementStripeState,
  isAdminFreeUser: boolean,
): AIEntitlementResult {
  if (isAdminFreeUser) {
    return {
      hasAI: true,
      aiEntitlementSource: user.aiEntitlementSource === "grandfathered" ? "grandfathered" : "plan",
    };
  }

  if (stripeState.hasPaidAIPlanOrUpgrade) {
    return { hasAI: true, aiEntitlementSource: user.planCode === "ai" ? "plan" : "upgrade" };
  }

  if (user.grandfatheredAI === true) {
    return { hasAI: true, aiEntitlementSource: "grandfathered" };
  }

  if (user.aiEntitlementSource === "legacy" && user.hasAI === true) {
    return { hasAI: true, aiEntitlementSource: "legacy" };
  }

  return { hasAI: false, aiEntitlementSource: "none" };
}
