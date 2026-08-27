import {
  applyMetaAudienceProfile,
  assertAudienceCreativeMatch,
  assertAllAudienceCreativeMatches,
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
    expect(resolveAudienceSegment({ leadType: "final_expense", audienceSegment: "veteran" })).toBe("veteran");
    expect(resolveAudienceSegment({ leadType: "final_expense", audienceSegment: "trucker" })).toBe("trucker");
  });

  test("mortgage, final expense, and IUL use validated product interests", () => {
    expect(getMetaAudienceProfile({ leadType: "mortgage_protection" }).interestGroups[0].map((i) => i.name)).toEqual(["Mortgage loans"]);
    expect(getMetaAudienceProfile({ leadType: "final_expense" }).interestGroups[0].map((i) => i.name)).toEqual(["Life insurance"]);
    expect(getMetaAudienceProfile({ leadType: "iul" }).interestGroups.map((group) => group.map((i) => i.name))).toEqual([
      ["Life insurance"],
      [
      "Investment strategy",
      "Investment management",
      ],
    ]);
  });

  test("Spanish uses Meta Spanish (All) plus the selected product audience", () => {
    const profile = getMetaAudienceProfile({ leadType: "mortgage_protection", audienceSegment: "spanish" });
    const targeting = applyMetaAudienceProfile(buildMetaStateTargeting(["AZ"]), profile);
    expect(targeting.locales).toEqual([1002]);
    expect(targeting.flexible_spec[0].interests.map((i: any) => i.id)).toEqual(["6003141785766"]);
  });

  test("trucker uses Semi-trailer truck without widening back to Logistics", () => {
    const profile = getMetaAudienceProfile({ leadType: "trucker", audienceSegment: "standard" });
    expect(profile.audienceSegment).toBe("trucker");
    expect(profile.interestGroups[0]).toEqual([{ id: "6003523283642", name: "Semi-trailer truck" }]);
    expect(profile.qualificationMode).toBe("interest_plus_identity_creative_and_funnel");
  });

  test("veteran fails closed to identity-specific creative and funnel because Meta rejects veteran interests", () => {
    const profile = getMetaAudienceProfile({ leadType: "veteran", audienceSegment: "standard" });
    const targeting = applyMetaAudienceProfile(buildMetaStateTargeting(["AZ"]), profile);
    expect(profile.audienceSegment).toBe("veteran");
    expect(profile.interestGroups).toEqual([]);
    expect(profile.qualificationMode).toBe("identity_creative_and_funnel");
    expect(profile.deliveryMode).toBe("BROAD_META_DELIVERY_WITH_VETERAN_CREATIVE_FUNNEL_QUALIFICATION");
    expect(targeting.flexible_spec).toBeUndefined();
  });

  test("mortgage variants stay separate controlled audiences", () => {
    expect(getMetaAudienceProfile({ leadType: "mortgage_protection" }).interestGroups).toEqual([[
      { id: "6003141785766", name: "Mortgage loans" },
    ]]);
    expect(getMetaAudienceProfile({
      leadType: "mortgage_protection",
      mortgageTargetingVariant: "mortgage_insurance",
    }).interestGroups).toEqual([[
      { id: "6003644772146", name: "Mortgage insurance" },
    ]]);
  });

  test.each([
    ["veteran", "veteran", []],
    ["mortgage_protection", "standard", [["6003141785766"]]],
    ["trucker", "trucker", [["6003523283642"]]],
    ["iul", "standard", [["6003353637860"], ["6003331621377", "6003293787730"]]],
    ["final_expense", "standard", [["6003353637860"]]],
    ["mortgage_protection", "veteran", [["6003141785766"]]],
    ["iul", "veteran", [["6003353637860"], ["6003331621377", "6003293787730"]]],
    ["final_expense", "veteran", [["6003353637860"]]],
    ["mortgage_protection", "trucker", [["6003523283642"], ["6003141785766"]]],
    ["iul", "trucker", [["6003523283642"], ["6003353637860"], ["6003331621377", "6003293787730"]]],
    ["final_expense", "trucker", [["6003523283642"], ["6003353637860"]]],
    ["mortgage_protection", "spanish", [["6003141785766"]]],
    ["iul", "spanish", [["6003353637860"], ["6003331621377", "6003293787730"]]],
    ["final_expense", "spanish", [["6003353637860"]]],
  ] as const)("builds exact %s/%s targeting matrix", (leadType, audienceSegment, expectedGroups) => {
    const profile = getMetaAudienceProfile({ leadType, audienceSegment });
    expect(profile.interestGroups.map((group) => group.map((interest) => interest.id))).toEqual(expectedGroups);
    expect(profile.locales).toEqual(audienceSegment === "spanish" ? [1002] : []);
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

  test("rejects a mismatched secondary creative instead of validating only the first", () => {
    expect(() => assertAllAudienceCreativeMatches({
      leadType: "veteran",
      audienceSegment: "veteran",
      creatives: [
        { primaryText: "Veterans who served can review private coverage options." },
        { primaryText: "Affordable coverage for everyone." },
      ],
    })).toThrow("Creative 2 failed");
  });
});
