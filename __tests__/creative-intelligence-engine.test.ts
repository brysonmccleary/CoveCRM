import { CREATIVE_FAMILIES } from "@/lib/facebook/creativeIntelligence/families";
import { CREATIVE_LAYOUTS } from "@/lib/facebook/creativeIntelligence/layouts";
import { generateCreativeIntelligenceDrafts, scoreBatchDiversity } from "@/lib/facebook/creativeIntelligence/engine";
import { buildSelectorContract, assertSelectorFunnelConsistency, selectorToFunnelStep } from "@/lib/facebook/creativeIntelligence/selectors";
import { assertApprovedHeroAmount, buildSafeGeneralCapability } from "@/lib/facebook/creativeIntelligence/capabilities";
import { creativeSimilarity } from "@/lib/facebook/creativeIntelligence/similarity";
import { evaluateCreativeClaims, type RegisteredClaim } from "@/lib/facebook/claimsRegistry";
import { reserveGeneratedDrafts } from "@/lib/facebook/creativeUsage";
import { scoreFamilyEvidence } from "@/lib/facebook/performanceLearning";
import { cssExecutionCounts } from "@/lib/facebook/creativeIntelligence/executions";

const COMBINATIONS = [
  ["veteran", "veteran", "en"],
  ["mortgage_protection", "standard", "en"],
  ["trucker", "trucker", "en"],
  ["iul", "standard", "en"],
  ["final_expense", "spanish", "es"],
  ["final_expense", "standard", "en"],
  ["mortgage_protection", "veteran", "en"],
  ["iul", "veteran", "en"],
  ["final_expense", "veteran", "en"],
  ["mortgage_protection", "trucker", "en"],
  ["iul", "trucker", "en"],
  ["final_expense", "trucker", "en"],
  ["mortgage_protection", "spanish", "es"],
  ["iul", "spanish", "es"],
  ["veteran", "veteran", "es"],
  ["trucker", "trucker", "es"],
] as const;

describe("global creative intelligence engine", () => {
  it("declares twelve feed-visible layout contracts with distinct renderer families", () => {
    expect(CREATIVE_LAYOUTS).toHaveLength(12);
    expect(new Set(CREATIVE_LAYOUTS.map((layout) => layout.rendererFamily)).size).toBe(12);
    expect(CREATIVE_LAYOUTS.every((layout) => layout.slots.length >= 5 && layout.meaningfulComposition.length > 20)).toBe(true);
  });

  it("contains every researched macro family in the generalized registry", () => {
    const ids = new Set(CREATIVE_FAMILIES.map((family) => family.familyId));
    for (const id of [
      "VET_IDENTITY_AGE_AMOUNT_CORE", "VET_STORY_VIDEO", "FE_COST_FAMILY_BURDEN",
      "MP_HOME_BALANCE_FAMILY", "IUL_TAX_CASH_EDUCATION", "TRK_OCCUPATION_AMOUNT_BENEFITS",
      "ES_FE_FAMILY_BURDEN", "ES_MP_LIVING_BENEFIT", "ES_IUL_EDUCATION",
    ]) expect(ids.has(id)).toBe(true);
  });

  it("ships the CSS-first execution capacity without a paid image dependency", () => {
    expect(cssExecutionCounts()).toEqual({
      veteran: 40,
      finalExpense: 30,
      mortgage: 30,
      iul: 30,
      trucker: 30,
      spanish: 110,
    });
  });

  it("uses strong safe direct-response copy without inventing gated claims", () => {
    const drafts = Array.from({ length: 12 }, (_, index) => generateCreativeIntelligenceDrafts({
      vertical: "veteran", audienceSegment: "veteran", language: "en", userKey: `safe-dr-${index}`,
      campaignName: "Safe DR QA", requestedCount: 1, generationNonce: `safe-dr-${index}`,
    })[0]);
    const text = drafts.map((draft) => `${draft.headline} ${draft.primaryText}`).join(" ");
    expect(drafts.every((draft) => draft.copyMode === "safe_direct_response" && draft.cssExecutionId.startsWith("VET_CSS_"))).toBe(true);
    expect(text).not.toMatch(/licensed agent can explain|private insurance options can be reviewed|family, budget, and long-term priorities/i);
    expect(text).not.toMatch(/\$\d|no medical exam|no waiting period|guaranteed acceptance|guaranteed rate/i);
  });

  it.each(COMBINATIONS)("generates a diverse review batch for %s/%s/%s without Meta writes", (vertical, audienceSegment, language) => {
    const drafts = generateCreativeIntelligenceDrafts({
      vertical, audienceSegment, language, userKey: `qa-${vertical}-${audienceSegment}-${language}`,
      campaignName: "Local generation QA", requestedCount: 3, generationNonce: `nonce-${vertical}-${audienceSegment}-${language}`,
    });
    expect(drafts).toHaveLength(3);
    expect(drafts.every((draft) => draft.leadType === vertical && draft.language === language)).toBe(true);
    expect(scoreBatchDiversity(drafts).score).toBeGreaterThanOrEqual(0.65);
    expect(new Set(drafts.map((draft) => draft.layoutId)).size).toBeGreaterThanOrEqual(2);
    expect(drafts.every((draft) => draft.capabilitySource === "safe_general")).toBe(true);
  });

  it("derives eligibility ranges from configured capability data and shares exact funnel options", () => {
    const capability = {
      ...buildSafeGeneralCapability("final_expense"), capabilityId: "carrier-product-v1",
      carrier: "Configured Carrier", product: "Configured Product", productIdentifier: "FORM-1",
      issueAgeMin: 50, issueAgeMax: 79, faceAmountMin: 10_000, faceAmountMax: 35_000,
      approvalSource: "carrier underwriting guide", approvalMetadata: { source: "approved" },
    };
    const selector = buildSelectorContract({ vertical: "final_expense", requestedType: "age_range", capability });
    const step = selectorToFunnelStep(selector);
    expect(selector.options).toEqual(["50–59", "60–69", "70–79"]);
    expect(assertSelectorFunnelConsistency(selector, step)).toBe(true);
    expect(() => assertSelectorFunnelConsistency(selector, { ...step, options: ["50–80"] })).toThrow(/do not match/i);
  });

  it("classifies same-ad word tweaks as near duplicates", () => {
    const base = { winningFamilyId: "F", layoutId: "L", headline: "Protect your family today", primaryText: "Review coverage options for your family", bulletPoints: ["Clear options"], imageDirection: "family home", offerClass: "review", selectorContract: { options: ["A", "B"] }, cta: "Review Options" };
    const changed = { ...base, headline: "Protect your family now" };
    expect(creativeSimilarity(base, base).classification).toBe("EXACT_DUPLICATE");
    expect(creativeSimilarity(base, changed).classification).toBe("NEAR_DUPLICATE");
  });

  it("hard-blocks unsupported claims and allows a substantiated approved capability", () => {
    const claim: RegisteredClaim = {
      claimId: "no_medical_exam", claimText: "No Medical Exam", pattern: "no\\s+medical\\s+exam",
      classification: "CLEAN", eligibleProducts: ["final_expense"], carrierBasis: "Carrier guide",
      states: ["AZ"], version: "v1", expiresAt: "2030-01-01", approvedBy: "compliance",
      requiredCapabilities: ["medical_exam:not_required"],
    };
    const unsupported = evaluateCreativeClaims({ creativeText: "No medical exam", leadType: "final_expense", states: ["AZ"], landingPageSnapshot: "Landing", claims: [claim], productCapability: null, now: new Date("2026-01-01") });
    expect(unsupported.launchAllowed).toBe(false);
    expect(unsupported.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/does not substantiate/i)]));
    const supported = evaluateCreativeClaims({
      creativeText: "No medical exam", leadType: "final_expense", states: ["AZ"], landingPageSnapshot: "Landing", claims: [claim],
      productCapability: { medicalExamRequirement: "not_required" }, now: new Date("2026-01-01"),
    });
    expect(supported.launchAllowed).toBe(true);
  });

  it("creates expiring review-time reservations before launch", async () => {
    const insertMany = jest.fn().mockResolvedValue([]);
    const usageModel = { init: jest.fn(), deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }), insertMany };
    const drafts = generateCreativeIntelligenceDrafts({ vertical: "veteran", audienceSegment: "veteran", language: "en", userKey: "reservation-user", campaignName: "Reservation QA", requestedCount: 2, generationNonce: "reservation-nonce" });
    const result = await reserveGeneratedDrafts({ userEmail: "agent@example.com", generationId: "reservation-nonce", drafts, usageModel });
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(insertMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ status: "draft_reserved", userEmail: "agent@example.com", layoutId: expect.any(String), semanticFingerprint: expect.any(String) }),
    ]), { ordered: true });
  });

  it("keeps tiny samples neutral and only boosts evidence-backed quality", () => {
    expect(scoreFamilyEvidence({ spend: 8, impressions: 300, leads: 1, qualifiedLeads: 1, appointments: 0, sales: 0 }).multiplier).toBe(1);
    const qualified = scoreFamilyEvidence({ spend: 800, impressions: 30_000, leads: 60, qualifiedLeads: 30, appointments: 12, sales: 4 });
    expect(qualified.eligibleForBoost).toBe(true);
    expect(qualified.multiplier).toBeGreaterThan(1);
    expect(qualified.multiplier).toBeLessThanOrEqual(1.35);
  });

  it("binds approved hero amounts and benefits, but never invents them without capability data", () => {
    const capability = {
      ...buildSafeGeneralCapability("veteran"),
      capabilityId: "qa-veteran-capability",
      carrier: "QA Carrier",
      product: "QA Product",
      productIdentifier: "QA-VET-1",
      states: ["AZ"],
      issueAgeMin: 45,
      issueAgeMax: 80,
      faceAmountMin: 25_000,
      faceAmountMax: 100_000,
      medicalExamRequirement: "not_required" as const,
      immediateBenefitRules: ["immediate"],
      premiumGuarantees: ["level guaranteed"],
      approvalSource: "QA carrier guide",
    };
    const approved = generateCreativeIntelligenceDrafts({
      vertical: "veteran", audienceSegment: "veteran", language: "en", userKey: "capability-qa",
      campaignName: "Capability QA", requestedCount: 1, generationNonce: "approved-capability", location: "AZ",
      applicantAge: 60, productCapability: capability, preferredFamilyId: "VET_IDENTITY_AGE_AMOUNT_CORE",
    })[0];
    expect(approved.displayAmount).toBe("$100,000");
    expect(approved.capabilityBenefits).toEqual(expect.arrayContaining(["No medical exam", "Immediate benefit", "Premium guarantee"]));
    expect(approved.capabilityDisclosures).toEqual(expect.arrayContaining([expect.stringMatching(/carrier, state, age, health/i)]));
    const safe = generateCreativeIntelligenceDrafts({
      vertical: "veteran", audienceSegment: "veteran", language: "en", userKey: "safe-qa",
      campaignName: "Safe QA", requestedCount: 1, generationNonce: "missing-capability",
    })[0];
    expect(safe.displayAmount).toBeUndefined();
    expect(safe.capabilityBenefits).toEqual([]);
    expect(() => assertApprovedHeroAmount(capability, "$250,000")).toThrow(/not supported/i);
  });

  it("blocks expired, wrong-state, and wrong-age configured capabilities", () => {
    const base = {
      ...buildSafeGeneralCapability("final_expense"), capabilityId: "blocked-capability", carrier: "QA Carrier",
      product: "QA Product", productIdentifier: "QA-FE-1", states: ["AZ"], issueAgeMin: 50, issueAgeMax: 75,
      approvalSource: "QA carrier guide",
    };
    const generate = (productCapability: typeof base, location = "AZ", applicantAge = 60) => generateCreativeIntelligenceDrafts({
      vertical: "final_expense", audienceSegment: "standard", language: "en", userKey: "blocked-qa",
      campaignName: "Blocked QA", requestedCount: 1, generationNonce: `${location}-${applicantAge}-${productCapability.expiresAt || "active"}`,
      location, applicantAge, productCapability,
    });
    expect(() => generate({ ...base, expiresAt: "2020-01-01" })).toThrow(/expired/i);
    expect(() => generate(base, "CA")).toThrow(/not approved for CA/i);
    expect(() => generate(base, "AZ", 80)).toThrow(/issue age 80/i);
  });

  it("does not mistake private coverage for a government comparison", () => {
    const evaluate = (creativeText: string) => evaluateCreativeClaims({
      creativeText, leadType: "veteran", states: ["AZ"], landingPageSnapshot: "", claims: [], now: new Date("2026-08-28"),
    });
    expect(evaluate("Review private coverage options").blockers).toHaveLength(0);
    expect(evaluate("Compare VA coverage with other options").blockers).toEqual(expect.arrayContaining([expect.stringMatching(/unregistered claim/i)]));
    expect(evaluate("This government program provides coverage").blockers).toEqual(expect.arrayContaining([expect.stringMatching(/unregistered claim/i)]));
    expect(evaluate("Official VA endorsed coverage").blockers).toEqual(expect.arrayContaining([expect.stringMatching(/unregistered claim/i)]));
  });

  it("recognizes all thirteen human-visible QA clusters as near duplicates", () => {
    const clusters = [
      ["P004", "P014", "audience_benefit_grid"], ["P029", "P032", "agent_trust_explainer"],
      ["P034", "P040", "ugc_talking_head"], ["P036", "P039", "educational_explainer_card"],
      ["P045", "P049", "educational_explainer_card"], ["P062", "P066", "problem_consequence_offer"],
      ["P064", "P067", "ugc_talking_head"], ["P089", "P092", "problem_consequence_offer"],
      ["P105", "P107", "educational_explainer_card"], ["P109", "P112", "comparison_two_column"],
      ["P127", "P140", "calculator_quiz_assessment"], ["P130", "P142", "notice_letter_paper"],
      ["P134", "P137", "audience_benefit_grid"],
    ];
    for (const [leftId, rightId, layoutId] of clusters) {
      const base = {
        winningFamilyId: `qa-${layoutId}`, layoutId, headline: "Review coverage options for your family",
        primaryText: "A clear review of available coverage choices.", bulletPoints: ["Options explained", "Family priorities"],
        imageIdentity: "graphic:shared-direction", backgroundClass: "graphic:editorial", colorScheme: "navy-gold",
        offerClass: "coverage_review", selectorContract: { type: "age_range", options: ["50-59", "60-69", "70+"] },
        cta: "Review options", heroHierarchy: `hierarchy:${layoutId}`, ctaPlacement: "bottom_bar", benefitStructure: `${layoutId}:2`,
      };
      const changed = { ...base, headline: "Review your family's coverage options", primaryText: "See clear available coverage choices." };
      expect(creativeSimilarity({ ...base, previewId: leftId }, { ...changed, previewId: rightId }).classification).toBe("NEAR_DUPLICATE");
    }
  });
});
