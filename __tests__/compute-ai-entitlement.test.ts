import { computeAIEntitlement } from "@/lib/billing/computeAIEntitlement";

describe("computeAIEntitlement", () => {
  test("admin-free override wins regardless of everything else", () => {
    const result = computeAIEntitlement(
      { hasAI: false, aiEntitlementSource: "none", grandfatheredAI: false, planCode: "base" },
      { hasPaidAIPlanOrUpgrade: false },
      true,
    );
    expect(result).toEqual({ hasAI: true, aiEntitlementSource: "plan" });
  });

  test("admin-free override preserves the grandfathered label if already set", () => {
    const result = computeAIEntitlement(
      { hasAI: true, aiEntitlementSource: "grandfathered", grandfatheredAI: true, planCode: "base" },
      { hasPaidAIPlanOrUpgrade: false },
      true,
    );
    expect(result).toEqual({ hasAI: true, aiEntitlementSource: "grandfathered" });
  });

  test("a paid AI plan item resolves to source 'plan' when planCode is ai", () => {
    const result = computeAIEntitlement(
      { hasAI: true, aiEntitlementSource: "plan", grandfatheredAI: false, planCode: "ai" },
      { hasPaidAIPlanOrUpgrade: true },
      false,
    );
    expect(result).toEqual({ hasAI: true, aiEntitlementSource: "plan" });
  });

  test("a paid AI item on a base-plan user (the $50 add-on) resolves to source 'upgrade'", () => {
    const result = computeAIEntitlement(
      { hasAI: true, aiEntitlementSource: "upgrade", grandfatheredAI: false, planCode: "base" },
      { hasPaidAIPlanOrUpgrade: true },
      false,
    );
    expect(result).toEqual({ hasAI: true, aiEntitlementSource: "upgrade" });
  });

  test("grandfatheredAI alone resolves to hasAI:true regardless of planCode", () => {
    const base = computeAIEntitlement(
      { hasAI: false, aiEntitlementSource: "none", grandfatheredAI: true, planCode: "base" },
      { hasPaidAIPlanOrUpgrade: false },
      false,
    );
    expect(base).toEqual({ hasAI: true, aiEntitlementSource: "grandfathered" });

    const free = computeAIEntitlement(
      { hasAI: false, aiEntitlementSource: "none", grandfatheredAI: true, planCode: "free" },
      { hasPaidAIPlanOrUpgrade: false },
      false,
    );
    expect(free).toEqual({ hasAI: true, aiEntitlementSource: "grandfathered" });
  });

  test("a paid AI item supersedes the grandfathered label if the user later genuinely upgrades", () => {
    const result = computeAIEntitlement(
      { hasAI: true, aiEntitlementSource: "grandfathered", grandfatheredAI: true, planCode: "ai" },
      { hasPaidAIPlanOrUpgrade: true },
      false,
    );
    expect(result).toEqual({ hasAI: true, aiEntitlementSource: "plan" });
  });

  test("existing 'legacy' entitlement (admin free-plan signups) is preserved", () => {
    const result = computeAIEntitlement(
      { hasAI: true, aiEntitlementSource: "legacy", grandfatheredAI: false, planCode: "free" },
      { hasPaidAIPlanOrUpgrade: false },
      false,
    );
    expect(result).toEqual({ hasAI: true, aiEntitlementSource: "legacy" });
  });

  test("a stale aiEntitlementSource:'legacy' with hasAI already false does not grant AI", () => {
    const result = computeAIEntitlement(
      { hasAI: false, aiEntitlementSource: "legacy", grandfatheredAI: false, planCode: "free" },
      { hasPaidAIPlanOrUpgrade: false },
      false,
    );
    expect(result).toEqual({ hasAI: false, aiEntitlementSource: "none" });
  });

  test("default: no admin, no paid item, no grandfather, no legacy -> no AI", () => {
    const result = computeAIEntitlement(
      { hasAI: false, aiEntitlementSource: "none", grandfatheredAI: false, planCode: "base" },
      { hasPaidAIPlanOrUpgrade: false },
      false,
    );
    expect(result).toEqual({ hasAI: false, aiEntitlementSource: "none" });
  });
});
