import fs from "fs";
import path from "path";
import { generateCreativeIntelligenceDrafts, scoreBatchDiversity } from "../lib/facebook/creativeIntelligence/engine";
import { creativeSimilarity } from "../lib/facebook/creativeIntelligence/similarity";

const CONFIGS = [
  ["veteran", "veteran", "en"], ["final_expense", "standard", "en"],
  ["mortgage_protection", "standard", "en"], ["iul", "standard", "en"], ["trucker", "trucker", "en"],
  ["mortgage_protection", "veteran", "en"], ["iul", "veteran", "en"], ["final_expense", "veteran", "en"],
  ["mortgage_protection", "trucker", "en"], ["iul", "trucker", "en"], ["final_expense", "trucker", "en"],
  ["final_expense", "spanish", "es"], ["mortgage_protection", "spanish", "es"], ["iul", "spanish", "es"],
] as const;

function increment(map: Map<string, number>, key: unknown) {
  const value = String(key || "unknown");
  map.set(value, (map.get(value) || 0) + 1);
}

function top(map: Map<string, number>, total: number) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([key, count]) => ({ key, count, share: Number((count / total).toFixed(4)) }));
}

function simulate(customers: number, adsPerCustomer: number) {
  const all: Array<Record<string, any>> = [];
  const fingerprints = new Set<string>();
  const visualKeys = new Set<string>();
  const families = new Map<string, number>();
  const layouts = new Map<string, number>();
  const images = new Map<string, number>();
  const treatments = new Map<string, number>();
  const visualTypes = new Map<string, number>();
  const veteranVisualTypes = new Map<string, number>();
  const macros = new Map<string, number>();
  const batchScores: number[] = [];
  let exactDuplicates = 0;
  let nearDuplicates = 0;
  let diversityFailures = 0;
  const generationFailures: Array<{ customer: number; configuration: string; error: string }> = [];
  for (let customer = 0; customer < customers; customer++) {
    const [vertical, audienceSegment, language] = CONFIGS[customer % CONFIGS.length];
    let drafts: ReturnType<typeof generateCreativeIntelligenceDrafts>;
    try {
      drafts = generateCreativeIntelligenceDrafts({
        vertical, audienceSegment, language, userKey: `capacity-user-${customer}`,
        campaignName: `Capacity ${customer}`, requestedCount: adsPerCustomer,
        generationNonce: `capacity-${customers}-${adsPerCustomer}-${customer}`,
        recentUsage: all.slice(-5000),
      });
    } catch (error) {
      generationFailures.push({ customer, configuration: `${vertical}/${audienceSegment}/${language}`, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const batchScore = scoreBatchDiversity(drafts).score;
    batchScores.push(batchScore);
    if (batchScore < 0.8) diversityFailures += 1;
    for (const draft of drafts) {
      const fingerprint = String(draft.semanticFingerprint);
      if (fingerprints.has(fingerprint)) exactDuplicates += 1;
      const comparisons = all.slice(-5000);
      if (comparisons.some((existing) => creativeSimilarity(draft, existing).classification === "NEAR_DUPLICATE")) nearDuplicates += 1;
      fingerprints.add(fingerprint);
      visualKeys.add(`${draft.layoutId}|${draft.imageDirection}|${draft.backgroundDirection}|${draft.hookClass}`);
      increment(families, draft.winningFamilyId);
      increment(layouts, draft.layoutId);
      increment(images, `${draft.imageDirection}|${draft.backgroundDirection}`);
      increment(treatments, draft.cssExecutionId);
      increment(visualTypes, draft.visualTreatment);
      if (draft.leadType === "veteran" && draft.audienceSegment === "veteran" && draft.language === "en") {
        increment(veteranVisualTypes, draft.visualTreatment);
      }
      increment(macros, draft.cssMacroFamily);
      all.push(draft);
    }
  }
  const total = all.length;
  return {
    customers, adsPerCustomer, expectedAds: customers * adsPerCustomer, total, generationFailures: generationFailures.length,
    firstGenerationFailures: generationFailures.slice(0, 12), exactDuplicates, nearDuplicates,
    nearDuplicateRate: Number((nearDuplicates / total).toFixed(6)),
    semanticCollisionRate: Number((exactDuplicates / total).toFixed(6)),
    visualCollisionRate: Number(((total - visualKeys.size) / total).toFixed(6)),
    meaningfullyDistinctExecutions: new Set(all.map((draft) => draft.cssExecutionId)).size,
    rawVariantCapacity: "configuration-space exceeds simulated volume; not claimed as meaningful capacity",
    diversityFailures,
    batchDiversity: {
      average: Number((batchScores.reduce((sum, score) => sum + score, 0) / Math.max(1, batchScores.length)).toFixed(4)),
      minimum: Number(Math.min(...batchScores).toFixed(4)),
    },
    cssGraphicShare: Number(((visualTypes.get("graphic") || 0) / total).toFixed(4)),
    imageShare: Number(((visualTypes.get("image") || 0) / total).toFixed(4)),
    hybridShare: Number(((visualTypes.get("hybrid") || 0) / total).toFixed(4)),
    veteranCreativeMix: {
      cssGraphicShare: Number(((veteranVisualTypes.get("graphic") || 0) / Math.max(1, [...veteranVisualTypes.values()].reduce((sum, value) => sum + value, 0))).toFixed(4)),
      imageShare: Number(((veteranVisualTypes.get("image") || 0) / Math.max(1, [...veteranVisualTypes.values()].reduce((sum, value) => sum + value, 0))).toFixed(4)),
      hybridShare: Number(((veteranVisualTypes.get("hybrid") || 0) / Math.max(1, [...veteranVisualTypes.values()].reduce((sum, value) => sum + value, 0))).toFixed(4)),
    },
    pass: generationFailures.length === 0 && total === customers * adsPerCustomer && exactDuplicates === 0 && nearDuplicates === 0 && diversityFailures === 0,
    familyDistribution: top(families, total), layoutDistribution: top(layouts, total),
    cssTreatmentDistribution: top(treatments, total), macroDistribution: top(macros, total),
    visualTreatmentDistribution: top(visualTypes, total), imageReuse: top(images, total),
  };
}

const capacityPlans = process.env.COVE_CAPACITY_ONLY === "1000"
  ? [[200, 5] as const]
  : [[100, 3] as const, [100, 5] as const, [200, 5] as const];
const capacity = capacityPlans.map(([customers, adsPerCustomer]) => simulate(customers, adsPerCustomer));
const verticalQaConfigs = [CONFIGS[0], CONFIGS[1], CONFIGS[2], CONFIGS[3], CONFIGS[4], CONFIGS[11]];
const verticalQa = verticalQaConfigs.map(([vertical, audienceSegment, language], configIndex) => {
  const drafts: Array<Record<string, any>> = [];
  const failures: string[] = [];
  for (let batch = 0; batch < 20; batch++) {
    try {
      drafts.push(...generateCreativeIntelligenceDrafts({
        vertical, audienceSegment, language, userKey: `vertical-qa-${configIndex}-${batch}`,
        campaignName: `Vertical QA ${vertical}`, requestedCount: 5,
        generationNonce: `vertical-qa-${vertical}-${audienceSegment}-${batch}`, recentUsage: drafts,
      }));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    vertical: `${vertical}/${audienceSegment}/${language}`, generated: drafts.length,
    generationFailures: failures.length, firstFailures: failures.slice(0, 3),
    exactSignatures: drafts.length - new Set(drafts.map((draft) => draft.semanticFingerprint)).size,
    layouts: new Set(drafts.map((draft) => draft.layoutId)).size,
    families: new Set(drafts.map((draft) => draft.winningFamilyId)).size,
  };
});

const report = { generatedAt: new Date().toISOString(), capacity, verticalQa };
const reportPath = path.resolve("artifacts/creative-intelligence/css-first-direct-response/capacity-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  reportPath,
  capacity: capacity.map((entry) => ({
    customers: entry.customers,
    expectedAds: entry.expectedAds,
    total: entry.total,
    generationFailures: entry.generationFailures,
    exactDuplicates: entry.exactDuplicates,
    nearDuplicates: entry.nearDuplicates,
    diversityFailures: entry.diversityFailures,
    batchDiversity: entry.batchDiversity,
    veteranCreativeMix: entry.veteranCreativeMix,
    pass: entry.pass,
  })),
  verticalQa,
}, null, 2)}\n`);
