import { createHash } from "crypto";
import { buildCreativeGenerationSignature } from "@/lib/facebook/creativeIdentity";
import { getEligibleCreativeFamilies } from "./families";
import { assertLayoutCompatibility, getLayoutDefinition } from "./layouts";
import { assertApprovedHeroAmount, formatApprovedHeroAmount, getApprovedBenefitCopy, productCapabilitySupports, resolveProductCapability } from "./capabilities";
import { buildSelectorContract, selectorToFunnelStep } from "./selectors";
import { creativeSimilarity, semanticFingerprint } from "./similarity";
import { assertRenderedLanguageSafe, assertVisibleIdentity, getVisibleIdentityLabel, localizeSelectorContract } from "./localization";
import { assertCreativeQualityGates, fitCopyForLayout } from "./qualityGates";
import { selectProductionAsset } from "@/lib/facebook/creativeAssets/selection";
import { getEligibleCssExecutions, type CssExecutionDefinition } from "./executions";
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

function chooseExecution(
  input: CreativeEngineInput,
  seed: string,
  usedExecutionIds: Set<string>,
  usedMacroFamilies: Set<string>,
  usedLayouts: Set<LayoutId>,
  recentUsage: Array<Record<string, unknown>> = [],
  compatibleLayouts?: LayoutId[],
  photoCompatibility?: boolean
): CssExecutionDefinition {
  const eligibleExecutions = getEligibleCssExecutions({
    vertical: input.vertical,
    audienceSegment: input.audienceSegment,
    language: input.language,
    compatibleLayouts,
  });
  const photoFiltered = typeof photoCompatibility === "boolean"
    ? eligibleExecutions.filter((execution) => execution.photoCompatible === photoCompatibility)
    : eligibleExecutions;
  const executions = photoFiltered.length ? photoFiltered : eligibleExecutions;
  if (!executions.length) {
    throw new Error(`No CSS direct-response execution supports ${input.vertical}/${input.audienceSegment}/${input.language}.`);
  }
  const freshMacroAndLayout = executions.filter((execution) => !usedMacroFamilies.has(execution.macroFamily)
    && !usedLayouts.has(execution.layoutId));
  const freshMacro = executions.filter((execution) => !usedMacroFamilies.has(execution.macroFamily));
  const freshLayout = executions.filter((execution) => !usedLayouts.has(execution.layoutId));
  const unused = executions.filter((execution) => !usedExecutionIds.has(execution.executionId));
  const available = freshMacroAndLayout.length ? freshMacroAndLayout
    : freshMacro.length ? freshMacro : freshLayout.length ? freshLayout : unused.length ? unused : executions;
  const counts = available.map((execution) => ({
    execution,
    count: recentUsage.filter((row: any) => row?.cssExecutionId === execution.executionId).length,
  }));
  const minimumCount = Math.min(...counts.map((entry) => entry.count));
  return pick(counts.filter((entry) => entry.count <= minimumCount + 1).map((entry) => entry.execution), `${seed}|css-execution`);
}

function buildDraft(
  input: CreativeEngineInput,
  family: CreativeFamilyDefinition,
  index: number,
  execution: CssExecutionDefinition,
  forcedVeteranPhotoSlot?: boolean
): CreativeEngineDraft {
  const layoutId = execution.layoutId;
  const generationSeed = String((input as CreativeEngineInput & { generationSeed?: string }).generationSeed || input.generationNonce);
  const seed = `${input.userKey}|${generationSeed}|${input.vertical}|${input.audienceSegment}|${index}|${family.familyId}|${layoutId}`;
  const capabilityResolution = resolveProductCapability({ vertical: input.vertical, state: input.capabilityState || input.location, applicantAge: input.applicantAge, capability: input.productCapability });
  if (input.productCapability && capabilityResolution.errors.length > 0) {
    throw new Error(`Configured product capability failed validation: ${capabilityResolution.errors.join(" ")}`);
  }
  const copy = input.language === "es" && family.spanish ? family.spanish : family;
  const copyMode = capabilityResolution.source === "configured_product"
    ? "capability_enhanced_direct_response" as const
    : "safe_direct_response" as const;
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
  let imageDirection = pick(family.imageDirections, `${seed}|image`);
  const backgroundDirection = pick(family.backgroundDirections, `${seed}|background`);
  const visualLeadType = input.audienceSegment === "veteran" || input.audienceSegment === "trucker"
    ? input.audienceSegment : input.vertical;
  const staticAssetCounts: Record<string, number> = { veteran: 40, trucker: 40, mortgage_protection: 40 };
  const visualRoll = hashInt(`${seed}|css-first-share`) % 100;
  const imageThreshold = input.vertical === "veteran" && input.language === "en" ? 56 : 78;
  const hybridThreshold = Math.round((imageThreshold + 100) / 2);
  const requestedVisualTreatment = typeof forcedVeteranPhotoSlot === "boolean"
    ? (forcedVeteranPhotoSlot && execution.photoCompatible
      ? (visualRoll % 2 === 0 ? "hybrid" as const : "image" as const)
      : "graphic" as const)
    : execution.photoCompatible && visualRoll >= imageThreshold
      ? (visualRoll < hybridThreshold ? "hybrid" as const : "image" as const)
      : "graphic" as const;
  const photoRequested = requestedVisualTreatment !== "graphic";
  const photoBlocked = !execution.photoCompatible;
  const format: CreativeFormat = photoRequested ? "photo" : "graphic";
  assertLayoutCompatibility({ layoutId, vertical: family.vertical, format });
  const selectedAsset = !photoBlocked ? selectProductionAsset(input.productionAssets || [], {
    vertical: input.vertical,
    audienceSegment: input.audienceSegment,
    language: input.language,
    product: input.vertical,
    familyId: family.familyId,
    layoutId,
    format,
    userKey: input.userKey,
    seed,
    recentUsage: (input.recentUsage || []) as Array<Record<string, unknown>>,
    excludedAssetIds: new Set((input.recentUsage || [])
      .filter((row: any) => row?.generationNonce === input.generationNonce)
      .map((row: any) => String(row?.assetId || ""))
      .filter(Boolean)),
  }) : null;
  if (selectedAsset?.imageDirection || selectedAsset?.direction) {
    imageDirection = selectedAsset.imageDirection || selectedAsset.direction;
  }
  const hasStaticPhoto = Boolean(selectedAsset)
    || (photoRequested && !photoBlocked && Boolean(staticAssetCounts[visualLeadType]));
  const visualVariantIndex = hashInt(`${seed}|asset`) % 40;
  const imageIdentity = selectedAsset?.storageUrl || (hasStaticPhoto
    ? `/ad-backgrounds/${visualLeadType}/${visualVariantIndex + 1}.jpg`
    : `graphic:${backgroundDirection}`);
  const imageUrl = selectedAsset?.storageUrl || (hasStaticPhoto
    ? `/ad-backgrounds/${visualLeadType}/${visualVariantIndex + 1}.jpg`
    : `graphic:${backgroundDirection}`);
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
    visualTreatment: hasStaticPhoto ? requestedVisualTreatment : "graphic",
    visualVariantIndex,
    imageIdentity,
    imageUrl: imageUrl.startsWith("graphic:") ? "" : imageUrl,
    assetId: selectedAsset?.assetId || "",
    assetVisualFingerprint: selectedAsset?.visualFingerprint || "",
    assetType: selectedAsset?.assetType || "",
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
    copyMode,
    displayAmount,
    capabilityBenefits,
    capabilityDisclosures,
    visibleIdentityLabel,
    cssExecutionId: execution.executionId,
    cssMacroFamily: execution.macroFamily,
    cssRendererFamily: execution.rendererFamily,
    cssHierarchyTreatment: execution.hierarchyTreatment,
    cssPanelStructure: execution.panelStructure,
    cssBackgroundTreatment: execution.backgroundTreatment,
    cssTypographyTreatment: execution.typographyTreatment,
    cssSelectorPresentation: execution.selectorPresentation,
    cssCtaTreatment: execution.ctaTreatment,
    cssFrameTreatment: execution.frameTreatment,
    cssPaletteIndex: execution.paletteIndex,
    heroHierarchy: execution.hierarchyTreatment || layout.hierarchyClass,
    backgroundClass: hasStaticPhoto ? `${requestedVisualTreatment}:${visualLeadType}` : `css:${execution.backgroundTreatment}`,
    ctaPlacement: "bottom_bar",
    benefitStructure: benefits.length ? `${layoutId}:${benefits.length}` : `${layoutId}:0`,
    productCapability: capabilityResolution.source === "configured_product"
      ? capabilityResolution.capability
      : null,
    capabilityFallbackReasons: capabilityResolution.errors,
    variantId,
    generationNonce: input.generationNonce,
    creativeEngineVersion: 2,
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
    selector: fittedSelector, offerClass, cssExecutionId: execution.executionId,
  })).digest("hex");
  return {
    ...draft,
    semanticFingerprint: semantic,
    visualFingerprint: visual,
    creativeSignature: buildCreativeGenerationSignature({ ...draft, semanticFingerprint: semantic }),
  };
}

export function generateCreativeIntelligenceDrafts(input: CreativeEngineInput): CreativeEngineDraft[] {
  const internalInput = input as CreativeEngineInput & { generationRetry?: number; generationSeed?: string };
  const generationRetry = Number(internalInput.generationRetry || 0);
  const generationSeed = String(internalInput.generationSeed || input.generationNonce);
  const retryBatch = (reason: string): CreativeEngineDraft[] => {
    if (generationRetry >= 16) throw new Error(reason);
    return generateCreativeIntelligenceDrafts({
      ...input,
      generationRetry: generationRetry + 1,
      generationSeed: `${input.generationNonce}|batch-retry:${generationRetry + 1}`,
    } as CreativeEngineInput);
  };
  const resolvedCapability = resolveProductCapability({ vertical: input.vertical, state: input.capabilityState || input.location, applicantAge: input.applicantAge, capability: input.productCapability });
  if (input.productCapability && resolvedCapability.errors.length > 0) {
    throw new Error(`Configured product capability failed validation: ${resolvedCapability.errors.join(" ")}`);
  }
  const families = getEligibleCreativeFamilies(input).filter((family) =>
    family.requiredCapabilities.every((requirement) => productCapabilitySupports(resolvedCapability.capability, requirement))
    && getEligibleCssExecutions({
      vertical: input.vertical,
      audienceSegment: input.audienceSegment,
      language: input.language,
      compatibleLayouts: family.layoutIds,
    }).length > 0
  );
  if (families.length === 0) {
    throw new Error(`No approved creative families support ${input.vertical}/${input.audienceSegment}/${input.language}.`);
  }
  const requestedCount = Math.min(12, Math.max(1, Math.floor(input.requestedCount)));
  const supportedLayouts = [...new Set(families.flatMap((family) => family.layoutIds))];
  const drafts: CreativeEngineDraft[] = [];
  const usedFamilies = new Set<string>();
  const usedExecutionIds = new Set<string>();
  const usedMacroFamilies = new Set<string>();
  const usedLayouts = new Set<LayoutId>();
  const recent = (input.recentUsage || []).filter(Boolean) as Record<string, any>[];

  for (let slot = 0; slot < requestedCount; slot++) {
    let accepted: CreativeEngineDraft | null = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const seed = `${generationSeed}|slot:${slot}|attempt:${attempt}`;
      const selectionInput = { ...input, recentUsage: [...recent, ...drafts] };
      const preferredFamily = input.preferredFamilyId && slot === 0
        ? families.find((candidate) => candidate.familyId === input.preferredFamilyId)
        : undefined;
      const veteranEnglish = input.vertical === "veteran"
        && input.audienceSegment === "veteran"
        && input.language === "en";
      const priorVeteranIssuance = selectionInput.recentUsage.filter((row: any) => row?.leadType === "veteran"
        && row?.audienceSegment === "veteran" && row?.language === "en").length;
      // Two photo-capable placements in each nine-creative cycle produces a
      // stable 77.8% CSS / 22.2% image+hybrid mix, even for small customer batches.
      const forcedVeteranPhotoSlot = veteranEnglish
        ? priorVeteranIssuance % 9 === 3 || priorVeteranIssuance % 9 === 8
        : undefined;
      const execution = chooseExecution(
        selectionInput, seed, usedExecutionIds, usedMacroFamilies, usedLayouts, recent,
        preferredFamily?.layoutIds || supportedLayouts,
        forcedVeteranPhotoSlot
      );
      const compatibleFamilies = families.filter((candidate) => candidate.layoutIds.includes(execution.layoutId));
      const family = preferredFamily && compatibleFamilies.includes(preferredFamily)
        ? preferredFamily
        : chooseFamily(compatibleFamilies, selectionInput, seed, usedFamilies);
      const candidate = buildDraft(selectionInput, family, slot * 100 + attempt, execution, forcedVeteranPhotoSlot);
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
    if (!accepted) return retryBatch("Unable to produce a distinct creative set. Regenerate with a new nonce.");
    drafts.push(accepted);
    usedFamilies.add(accepted.winningFamilyId);
    usedExecutionIds.add(accepted.cssExecutionId);
    usedMacroFamilies.add(accepted.cssMacroFamily);
    usedLayouts.add(accepted.layoutId);
  }
  const diversity = scoreBatchDiversity(drafts);
  const diversityThreshold = 0.8;
  if (drafts.length >= 3 && diversity.score < diversityThreshold) {
    return retryBatch(`Generated batch did not meet Cove's family/layout/visual diversity threshold (${diversity.score}).`);
  }
  return drafts;
}

export function scoreBatchDiversity(drafts: Array<Record<string, any>>) {
  if (drafts.length <= 1) return { score: 1, dimensions: {} };
  const uniqueness = (key: string) => new Set(drafts.map((draft) => JSON.stringify(draft[key] ?? ""))).size / drafts.length;
  const dimensions = {
    family: uniqueness("winningFamilyId"),
    layout: uniqueness("layoutId"),
    execution: uniqueness("cssExecutionId"),
    hook: uniqueness("hookClass"),
    headline: uniqueness("headline"),
    visual: new Set(drafts.map((draft) => [
      draft.visualTreatment || "graphic",
      draft.cssRendererFamily || "",
      draft.cssBackgroundTreatment || draft.backgroundDirection || "",
      draft.cssTypographyTreatment || "",
      draft.cssFrameTreatment || "",
    ].join("|"))).size / drafts.length,
    offer: uniqueness("offerClass"),
    selector: new Set(drafts.map((draft) => JSON.stringify(draft.selectorContract || {}))).size / drafts.length,
    hierarchy: new Set(drafts.map((draft) => `${draft.heroHierarchy || ""}|${draft.ctaPlacement || ""}|${draft.benefitStructure || ""}`)).size / drafts.length,
  };
  const score = dimensions.family * 0.13 + dimensions.layout * 0.17
    + dimensions.execution * 0.16 + dimensions.visual * 0.13 + dimensions.hook * 0.09
    + dimensions.headline * 0.1 + dimensions.offer * 0.12
    + dimensions.selector * 0.04 + dimensions.hierarchy * 0.06;
  return { score: Number(score.toFixed(4)), dimensions };
}
