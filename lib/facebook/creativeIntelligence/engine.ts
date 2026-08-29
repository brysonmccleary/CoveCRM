import { createHash } from "crypto";
import { buildCreativeGenerationSignature } from "@/lib/facebook/creativeIdentity";
import { getEligibleCreativeFamilies } from "./families";
import { CREATIVE_LAYOUTS, assertLayoutCompatibility, getLayoutDefinition } from "./layouts";
import { assertApprovedHeroAmount, formatApprovedHeroAmount, getApprovedBenefitCopy, productCapabilitySupports, resolveProductCapability } from "./capabilities";
import { buildSelectorContract, selectorToFunnelStep } from "./selectors";
import { creativeSimilarity, semanticFingerprint } from "./similarity";
import { assertRenderedLanguageSafe, assertVisibleIdentity, getVisibleIdentityLabel, localizeSelectorContract } from "./localization";
import { assertCreativeQualityGates, fitCopyForLayout } from "./qualityGates";
import type {
  CreativeClass,
  CreativeEngineDraft,
  CreativeEngineInput,
  CreativeFamilyDefinition,
  CreativeFormat,
  LayoutId,
} from "./types";

function hashInt(value: string): number {
  return parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16) >>> 0;
}

function pick<T>(values: T[], seed: string): T {
  if (values.length === 0) throw new Error("Creative engine candidate pool is empty.");
  return values[hashInt(seed) % values.length];
}

function weightedClass(seed: string, verticalWeights: Record<CreativeClass, number>): CreativeClass {
  const roll = (hashInt(seed) % 10_000) / 10_000;
  if (roll < verticalWeights.core) return "core";
  if (roll < verticalWeights.core + verticalWeights.adjacent) return "adjacent";
  return "experimental";
}

const CLASS_WEIGHTS: Record<string, Record<CreativeClass, number>> = {
  veteran: { core: 0.65, adjacent: 0.25, experimental: 0.1 },
  final_expense: { core: 0.55, adjacent: 0.3, experimental: 0.15 },
  mortgage_protection: { core: 0.5, adjacent: 0.35, experimental: 0.15 },
  iul: { core: 0.45, adjacent: 0.4, experimental: 0.15 },
  trucker: { core: 0.45, adjacent: 0.35, experimental: 0.2 },
  spanish: { core: 0.5, adjacent: 0.35, experimental: 0.15 },
};

function candidateWeight(family: CreativeFamilyDefinition, input: CreativeEngineInput): number {
  const performance = Number(input.performanceWeights?.[family.familyId] || 1);
  const boundedPerformance = Number.isFinite(performance) ? Math.min(1.35, Math.max(0.75, performance)) : 1;
  const recentIssuance = (input.recentUsage || []).filter((row: any) =>
    String(row?.winningFamilyId || row?.creativeFamily || "") === family.familyId
  ).length;
  const concentrationPenalty = 1 / (1 + recentIssuance * 0.08);
  const offerIssuance = (input.recentUsage || []).filter((row: any) => row?.offerClass === family.offerClass).length;
  const headlineIssuance = (input.recentUsage || []).filter((row: any) => family.headlines.includes(String(row?.headline || ""))).length;
  const noveltyPenalty = 1 / (1 + offerIssuance * 0.14 + headlineIssuance * 0.09);
  return Math.max(family.explorationFloor, family.initialWeight * boundedPerformance * concentrationPenalty * noveltyPenalty);
}

function pickLeastUsed(values: string[], seed: string, recentUsage: Array<Record<string, unknown>>, key: string): string {
  const counts = values.map((value) => ({
    value,
    count: recentUsage.filter((row: any) => String(row?.[key] || "") === value).length,
  }));
  const minimum = Math.min(...counts.map((entry) => entry.count));
  return pick(counts.filter((entry) => entry.count === minimum).map((entry) => entry.value), seed);
}

const OFFER_VARIANTS: Record<string, string[]> = {
  veteran: ["eligibility_review", "private_coverage_options", "spouse_eligibility_review", "benefit_comparison"],
  trucker: ["driver_coverage_review", "driver_family_protection", "private_coverage_options"],
  mortgage_protection: ["mortgage_protection_review", "family_protection_review", "benefit_comparison"],
  final_expense: ["final_cost_planning", "eligibility_review", "private_coverage_options"],
  iul: ["cash_value_education", "retirement_strategy_review", "benefit_comparison"],
};

function resolveOfferClass(family: CreativeFamilyDefinition, input: CreativeEngineInput, seed: string): string {
  const variants = [...new Set([family.offerClass, ...(OFFER_VARIANTS[input.vertical] || [])])];
  return pickLeastUsed(variants, `${seed}|offer`, input.recentUsage || [], "offerClass");
}

function chooseFamily(
  families: CreativeFamilyDefinition[],
  input: CreativeEngineInput,
  seed: string,
  excluded: Set<string>
): CreativeFamilyDefinition {
  const desiredClass = weightedClass(`${seed}|class`, CLASS_WEIGHTS[input.language === "es" ? "spanish" : input.vertical]);
  const available = families.filter((family) => !excluded.has(family.familyId));
  const classPool = available.filter((family) => family.creativeClass === desiredClass);
  const pool = classPool.length ? classPool : available.length ? available : families;
  const scored = pool.map((family) => ({ family, weight: candidateWeight(family, input) }));
  const total = scored.reduce((sum, item) => sum + item.weight, 0);
  let roll = ((hashInt(`${seed}|family`) % 10_000) / 10_000) * total;
  for (const item of scored) {
    roll -= item.weight;
    if (roll <= 0) return item.family;
  }
  return scored[scored.length - 1].family;
}

function chooseLayout(family: CreativeFamilyDefinition, seed: string, usedLayouts: Set<LayoutId>, recentUsage: Array<Record<string, unknown>> = []): { layoutId: LayoutId; format: CreativeFormat } {
  const layoutPool = family.layoutIds.filter((layoutId) => !usedLayouts.has(layoutId));
  const available = layoutPool.length ? layoutPool : family.layoutIds;
  const counts = new Map(available.map((layoutId) => [layoutId, recentUsage.filter((row: any) => row?.layoutId === layoutId).length]));
  const minimumCount = Math.min(...available.map((layoutId) => counts.get(layoutId) || 0));
  const leastIssued = available.filter((layoutId) => (counts.get(layoutId) || 0) <= minimumCount + 1);
  const layoutId = pick(leastIssued, `${seed}|layout`);
  const layout = CREATIVE_LAYOUTS.find((candidate) => candidate.layoutId === layoutId);
  if (!layout) throw new Error(`Unknown creative layout: ${layoutId}`);
  const allowedFormats = family.formats.filter((format) => layout.compatibleFormats.includes(format));
  const format = pick(allowedFormats.length ? allowedFormats : layout.compatibleFormats, `${seed}|format`);
  assertLayoutCompatibility({ layoutId, vertical: family.vertical, format });
  return { layoutId, format };
}

function buildDraft(input: CreativeEngineInput, family: CreativeFamilyDefinition, index: number, layoutId: LayoutId, format: CreativeFormat): CreativeEngineDraft {
  const seed = `${input.userKey}|${input.generationNonce}|${input.vertical}|${input.audienceSegment}|${index}|${family.familyId}|${layoutId}`;
  const capabilityResolution = resolveProductCapability({ vertical: input.vertical, state: input.location, applicantAge: input.applicantAge, capability: input.productCapability });
  if (input.productCapability && capabilityResolution.errors.length > 0) {
    throw new Error(`Configured product capability failed validation: ${capabilityResolution.errors.join(" ")}`);
  }
  const copy = input.language === "es" && family.spanish ? family.spanish : family;
  const headlineRaw = pickLeastUsed(copy.headlines, `${seed}|headline`, input.recentUsage || [], "headline");
  const hook = pick(copy.hooks, `${seed}|hook`);
  const safeBenefits = pick(copy.benefitLists, `${seed}|benefits`);
  const capabilityBenefits = capabilityResolution.source === "configured_product"
    ? getApprovedBenefitCopy(capabilityResolution.capability, input.language)
    : [];
  const benefits = [...capabilityBenefits, ...safeBenefits].slice(0, 3);
  const cta = pick(copy.ctas, `${seed}|cta`);
  const selector = localizeSelectorContract(buildSelectorContract({
    vertical: input.vertical,
    requestedType: pick(family.selectorTypes, `${seed}|selector`),
    capability: capabilityResolution.capability,
  }), input.language);
  const fitted = fitCopyForLayout({ layoutId, headline: headlineRaw, body: hook, buttons: selector.options });
  const headline = fitted.headline;
  const fittedHook = fitted.body;
  const fittedSelector = { ...selector, options: fitted.buttons };
  const imageDirection = pick(family.imageDirections, `${seed}|image`);
  const backgroundDirection = pick(family.backgroundDirections, `${seed}|background`);
  const visualLeadType = input.audienceSegment === "veteran" || input.audienceSegment === "trucker"
    ? input.audienceSegment : input.vertical;
  const staticAssetCounts: Record<string, number> = { veteran: 40, trucker: 40, mortgage_protection: 40 };
  const photoBlocked = layoutId === "educational_explainer_card" || layoutId === "notice_letter_paper"
    || (layoutId === "audience_benefit_grid" && visualLeadType === "veteran");
  const photoRequested = format === "photo" || format === "video" || format === "ugc_video" || format === "agent_video";
  const hasStaticPhoto = photoRequested && !photoBlocked && Boolean(staticAssetCounts[visualLeadType]);
  const visualVariantIndex = hashInt(`${seed}|asset`) % 40;
  const imageIdentity = hasStaticPhoto
    ? `/ad-backgrounds/${visualLeadType}/${visualVariantIndex + 1}.jpg`
    : `graphic:${backgroundDirection}`;
  const variantId = `cie_${createHash("sha256").update(seed).digest("hex").slice(0, 18)}`;
  const amountLayouts: LayoutId[] = ["hero_amount_age_grid", "audience_benefit_grid", "portrait_hero_offer", "full_bleed_text_overlay"];
  const displayAmount = capabilityResolution.source === "configured_product" && amountLayouts.includes(layoutId)
    ? formatApprovedHeroAmount(capabilityResolution.capability)
    : undefined;
  assertApprovedHeroAmount(capabilityResolution.capability, displayAmount);
  const capabilityDisclosures = displayAmount
    ? [input.language === "es"
      ? "La disponibilidad varía según la compañía, el estado, la edad, la salud y la evaluación."
      : "Coverage amounts and eligibility vary by carrier, state, age, health, and underwriting."]
    : [];
  const visibleIdentityLabel = getVisibleIdentityLabel({
    vertical: input.vertical,
    audienceSegment: input.audienceSegment,
    language: input.language,
  });
  const layout = getLayoutDefinition(layoutId);
  const offerClass = resolveOfferClass(family, input, seed);
  const draft: CreativeEngineDraft = {
    leadType: input.vertical,
    audienceSegment: input.audienceSegment,
    language: input.language,
    campaignName: input.campaignName,
    winningFamilyId: family.familyId,
    creativeFamily: family.familyId,
    creativeClass: family.creativeClass,
    layoutId,
    format,
    hookClass: `${family.hookClass}:v${(index % 3) + 1}`,
    headlineClass: family.headlineClass,
    offerClass,
    imageDirection,
    backgroundDirection,
    imagePrompt: `${imageDirection}; ${backgroundDirection}; original Cove composition; no logos; no readable generated text`,
    visualTreatment: hasStaticPhoto ? "photo" : "graphic",
    visualVariantIndex,
    imageIdentity,
    primaryText: fittedHook,
    headline,
    description: benefits.join(" • "),
    cta,
    buttonLabels: fittedSelector.options,
    bulletPoints: benefits,
    selectorContract: fittedSelector,
    landingPageConfig: {
      headline,
      subheadline: fittedHook,
      benefitBullets: benefits,
      buttonLabels: fittedSelector.options,
      ctaStrip: cta,
      selectorContract: fittedSelector,
      selectorStep: selectorToFunnelStep(fittedSelector),
      creativeFamily: family.familyId,
      layoutId,
      capabilityId: capabilityResolution.capability.capabilityId,
      disclosures: capabilityDisclosures,
    },
    marketEvidence: family.marketEvidence,
    allowedClaimIds: family.allowedClaims,
    requiredCapabilities: family.requiredCapabilities,
    requiredDisclosures: family.requiredDisclosures,
    capabilityId: capabilityResolution.capability.capabilityId,
    capabilitySource: capabilityResolution.source,
    displayAmount,
    capabilityBenefits,
    capabilityDisclosures,
    visibleIdentityLabel,
    heroHierarchy: layout.hierarchyClass,
    backgroundClass: hasStaticPhoto ? `photo:${visualLeadType}` : `graphic:${backgroundDirection}`,
    ctaPlacement: "bottom_bar",
    benefitStructure: benefits.length ? `${layoutId}:${benefits.length}` : `${layoutId}:0`,
    productCapability: capabilityResolution.source === "configured_product"
      ? capabilityResolution.capability
      : null,
    capabilityFallbackReasons: capabilityResolution.errors,
    variantId,
    generationNonce: input.generationNonce,
    creativeEngineVersion: 1,
    generatedBy: "creative_intelligence_engine",
    copySource: "creative_intelligence_engine",
    renderLegacyCreative: false,
  };
  assertRenderedLanguageSafe(draft);
  assertVisibleIdentity(draft);
  assertCreativeQualityGates(draft);
  const semantic = semanticFingerprint(draft);
  const visual = createHash("sha256").update(JSON.stringify({
    layoutId, format, imageIdentity, imageDirection, backgroundDirection, hookClass: draft.hookClass,
    selector: fittedSelector, offerClass,
  })).digest("hex");
  return {
    ...draft,
    semanticFingerprint: semantic,
    visualFingerprint: visual,
    creativeSignature: buildCreativeGenerationSignature({ ...draft, semanticFingerprint: semantic }),
  };
}

export function generateCreativeIntelligenceDrafts(input: CreativeEngineInput): CreativeEngineDraft[] {
  const resolvedCapability = resolveProductCapability({ vertical: input.vertical, state: input.location, applicantAge: input.applicantAge, capability: input.productCapability });
  if (input.productCapability && resolvedCapability.errors.length > 0) {
    throw new Error(`Configured product capability failed validation: ${resolvedCapability.errors.join(" ")}`);
  }
  const families = getEligibleCreativeFamilies(input).filter((family) =>
    family.requiredCapabilities.every((requirement) => productCapabilitySupports(resolvedCapability.capability, requirement))
  );
  if (families.length === 0) {
    throw new Error(`No approved creative families support ${input.vertical}/${input.audienceSegment}/${input.language}.`);
  }
  const requestedCount = Math.min(12, Math.max(1, Math.floor(input.requestedCount)));
  const drafts: CreativeEngineDraft[] = [];
  const usedFamilies = new Set<string>();
  const usedLayouts = new Set<LayoutId>();
  const recent = (input.recentUsage || []).filter(Boolean) as Record<string, any>[];

  for (let slot = 0; slot < requestedCount; slot++) {
    let accepted: CreativeEngineDraft | null = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const seed = `${input.generationNonce}|slot:${slot}|attempt:${attempt}`;
      const selectionInput = { ...input, recentUsage: [...recent, ...drafts] };
      const family = input.preferredFamilyId && slot === 0
        ? families.find((candidate) => candidate.familyId === input.preferredFamilyId) || chooseFamily(families, selectionInput, seed, usedFamilies)
        : chooseFamily(families, selectionInput, seed, usedFamilies);
      const { layoutId, format } = chooseLayout(family, seed, usedLayouts, recent);
      const candidate = buildDraft(selectionInput, family, slot * 100 + attempt, layoutId, format);
      const visualLeadForCandidate = input.audienceSegment === "veteran" || input.audienceSegment === "trucker"
        ? input.audienceSegment : input.vertical;
      if (requestedCount === 1
        && ["veteran", "trucker", "mortgage_protection"].includes(visualLeadForCandidate)
        && candidate.visualTreatment !== "photo") {
        continue;
      }
      const comparisons = [...drafts, ...recent];
      const duplicate = comparisons.some((existing) => {
        const similarity = creativeSimilarity(candidate, existing);
        return similarity.classification === "EXACT_DUPLICATE" || similarity.classification === "NEAR_DUPLICATE";
      });
      if (!duplicate) {
        accepted = candidate;
        break;
      }
    }
    if (!accepted) throw new Error("Unable to produce a distinct creative set. Regenerate with a new nonce.");
    drafts.push(accepted);
    usedFamilies.add(accepted.winningFamilyId);
    usedLayouts.add(accepted.layoutId);
  }
  if (drafts.length >= 2) {
    const treatments = new Set(drafts.map((draft) => draft.visualTreatment));
    if (treatments.size === 1) {
      const desired: CreativeFormat = drafts[0].visualTreatment === "photo" ? "graphic" : "photo";
      const replaceIndex = drafts.findIndex((draft) => {
        const layout = CREATIVE_LAYOUTS.find((candidate) => candidate.layoutId === draft.layoutId);
        if (!layout?.compatibleFormats.includes(desired)) return false;
        if (desired === "graphic") return true;
        const visualLead = input.audienceSegment === "veteran" || input.audienceSegment === "trucker"
          ? input.audienceSegment : input.vertical;
        const blocked = draft.layoutId === "educational_explainer_card" || draft.layoutId === "notice_letter_paper"
          || (draft.layoutId === "audience_benefit_grid" && visualLead === "veteran");
        return !blocked && ["veteran", "trucker", "mortgage_protection"].includes(visualLead);
      });
      if (replaceIndex >= 0) {
        const current = drafts[replaceIndex];
        const visualLead = input.audienceSegment === "veteran" || input.audienceSegment === "trucker"
          ? input.audienceSegment : input.vertical;
        const imageIdentity = desired === "photo"
          ? `/ad-backgrounds/${visualLead}/${Number(current.visualVariantIndex || 0) + 1}.jpg`
          : `graphic:${current.backgroundDirection}`;
        const updated = {
          ...current,
          format: desired,
          visualTreatment: desired,
          imageIdentity,
        };
        drafts[replaceIndex] = {
          ...updated,
          semanticFingerprint: semanticFingerprint(updated),
          visualFingerprint: createHash("sha256").update(JSON.stringify({
            layoutId: updated.layoutId, format: desired, imageIdentity,
            imageDirection: updated.imageDirection, backgroundDirection: updated.backgroundDirection,
            hookClass: updated.hookClass, selector: updated.selectorContract, offerClass: updated.offerClass,
          })).digest("hex"),
          creativeSignature: buildCreativeGenerationSignature(updated),
        };
      }
    }
  }
  const diversity = scoreBatchDiversity(drafts);
  const diversityThreshold = drafts.length > 4 ? 0.72 : 0.8;
  if (drafts.length >= 3 && diversity.score < diversityThreshold) {
    throw new Error(`Generated batch did not meet Cove's family/layout/visual diversity threshold (${diversity.score}).`);
  }
  return drafts;
}

export function scoreBatchDiversity(drafts: Array<Record<string, any>>) {
  if (drafts.length <= 1) return { score: 1, dimensions: {} };
  const uniqueness = (key: string) => new Set(drafts.map((draft) => JSON.stringify(draft[key] ?? ""))).size / drafts.length;
  const dimensions = {
    family: uniqueness("winningFamilyId"),
    layout: uniqueness("layoutId"),
    hook: uniqueness("hookClass"),
    headline: uniqueness("headline"),
    visual: new Set(drafts.map((draft) => `${draft.imageDirection || ""}|${draft.backgroundDirection || ""}`)).size / drafts.length,
    offer: uniqueness("offerClass"),
    selector: new Set(drafts.map((draft) => JSON.stringify(draft.selectorContract || {}))).size / drafts.length,
    hierarchy: new Set(drafts.map((draft) => `${draft.heroHierarchy || ""}|${draft.ctaPlacement || ""}|${draft.benefitStructure || ""}`)).size / drafts.length,
  };
  const score = dimensions.family * 0.16 + dimensions.layout * 0.22
    + dimensions.visual * 0.15 + dimensions.hook * 0.1
    + dimensions.headline * 0.1 + dimensions.offer * 0.12
    + dimensions.selector * 0.05 + dimensions.hierarchy * 0.1;
  return { score: Number(score.toFixed(4)), dimensions };
}
