export const RECRUITING_PLANS = {
  growth: {
    key: "growth",
    name: "Social Growth",
    monthlyPrice: 249,
    maxPlatforms: 1,
    dmEnabled: false,
    description: "Always-on targeted likes, story engagement, follows, and connections on one platform.",
  },
  growth_recruiting: {
    key: "growth_recruiting",
    name: "Growth + Recruiting",
    monthlyPrice: 499,
    maxPlatforms: 2,
    dmEnabled: true,
    description: "Both platforms, high-confidence recruiting DMs, follows, connections, and targeted growth.",
  },
} as const;

export type RecruitingPlanKey = keyof typeof RECRUITING_PLANS;

export function normalizeRecruitingPlan(value: unknown): RecruitingPlanKey {
  return value === "growth" ? "growth" : "growth_recruiting";
}

export function assertPlanAllowsCampaign(planKey: RecruitingPlanKey, platforms: string[], dmEnabled: boolean) {
  const plan = RECRUITING_PLANS[planKey];
  if (platforms.length > plan.maxPlatforms) throw new Error(`${plan.name} supports ${plan.maxPlatforms} platform at a time.`);
  if (dmEnabled && !plan.dmEnabled) throw new Error("Choose Growth + Recruiting to turn on DMs.");
}
