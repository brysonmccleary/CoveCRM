import {
  applyMetaAudienceProfile,
  assertAudienceCreativeMatch,
  getMetaAudienceProfile,
  resolveAudienceSegment,
} from "@/lib/facebook/audienceTargeting";
import { buildMetaStateTargeting } from "@/lib/facebook/geo/metaTargeting";

describe("Meta special-category audience profiles", () => {
  test("server-side normalization fixes general veteran and trucker wizard values", () => {
    expect(resolveAudienceSegment({ leadType: "veteran", audienceSegment: "standard" })).toBe("veteran");
    expect(resolveAudienceSegment({ leadType: "trucker", audienceSegment: "standard" })).toBe("trucker");
  });

  test("rejects impossible cross-segment combinations", () => {
    expect(() => resolveAudienceSegment({ leadType: "veteran", audienceSegment: "trucker" })).toThrow();
    expect(() => resolveAudienceSegment({ leadType: "final_expense", audienceSegment: "veteran" })).toThrow();
  });

  test("mortgage, final expense, and IUL use validated product interests", () => {
    expect(getMetaAudienceProfile({ leadType: "mortgage_protection" }).interestGroups[0].map((i) => i.name)).toEqual(["Mortgage loans"]);
    expect(getMetaAudienceProfile({ leadType: "final_expense" }).interestGroups[0].map((i) => i.name)).toEqual(["Life insurance"]);
    expect(getMetaAudienceProfile({ leadType: "iul" }).interestGroups[0].map((i) => i.name)).toEqual([
      "Life insurance",
      "Investment strategy",
      "Investment management",
    ]);
  });

  test("Spanish uses Meta Spanish (All) plus the selected product audience", () => {
    const profile = getMetaAudienceProfile({ leadType: "mortgage_protection", audienceSegment: "spanish" });
    const targeting = applyMetaAudienceProfile(buildMetaStateTargeting(["AZ"]), profile);
    expect(targeting.locales).toEqual([1002]);
    expect(targeting.flexible_spec[0].interests.map((i: any) => i.id)).toEqual(["6003141785766"]);
  });

  test("trucker uses the validated Logistics interest and explicit funnel qualification", () => {
    const profile = getMetaAudienceProfile({ leadType: "trucker", audienceSegment: "standard" });
    expect(profile.audienceSegment).toBe("trucker");
    expect(profile.interestGroups[0]).toEqual([{ id: "6003531058863", name: "Logistics" }]);
    expect(profile.qualificationMode).toBe("interest_plus_identity_creative_and_funnel");
  });

  test("veteran fails closed to identity-specific creative and funnel because Meta rejects veteran interests", () => {
    const profile = getMetaAudienceProfile({ leadType: "veteran", audienceSegment: "standard" });
    const targeting = applyMetaAudienceProfile(buildMetaStateTargeting(["AZ"]), profile);
    expect(profile.audienceSegment).toBe("veteran");
    expect(profile.interestGroups).toEqual([]);
    expect(profile.qualificationMode).toBe("identity_creative_and_funnel");
    expect(targeting.flexible_spec).toBeUndefined();
  });

  test.each([
    ["veteran", "veteran", "Veterans who served can review private coverage options."],
    ["trucker", "trucker", "CDL truck drivers can review coverage options."],
    ["mortgage_protection", "standard", "Review mortgage protection for your home."],
    ["iul", "standard", "Explore IUL cash value life insurance options."],
    ["final_expense", "spanish", "Revise opciones de cobertura para gastos finales."],
  ] as const)("accepts matching %s/%s copy", (leadType, audienceSegment, creativeText) => {
    expect(() => assertAudienceCreativeMatch({ leadType, audienceSegment, creativeText })).not.toThrow();
  });

  test("blocks a veteran launch whose ad and funnel never qualify veterans", () => {
    expect(() => assertAudienceCreativeMatch({
      leadType: "veteran",
      audienceSegment: "standard",
      creativeText: "Affordable coverage options for your family.",
    })).toThrow("Veteran campaigns must explicitly qualify");
  });

  test("blocks English copy from a Spanish campaign", () => {
    expect(() => assertAudienceCreativeMatch({
      leadType: "iul",
      audienceSegment: "spanish",
      creativeText: "Explore IUL cash value options.",
    })).toThrow("Spanish campaigns must use Spanish-language ad copy");
  });
});
