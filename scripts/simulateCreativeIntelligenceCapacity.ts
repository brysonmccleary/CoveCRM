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
  let exactDuplicates = 0;
  let nearDuplicates = 0;
  let diversityFailures = 0;
  for (let customer = 0; customer < customers; customer++) {
    const [vertical, audienceSegment, language] = CONFIGS[customer % CONFIGS.length];
    const drafts = generateCreativeIntelligenceDrafts({
      vertical, audienceSegment, language, userKey: `capacity-user-${customer}`,
      campaignName: `Capacity ${customer}`, requestedCount: adsPerCustomer,
      generationNonce: `capacity-${customers}-${adsPerCustomer}-${customer}`,
      recentUsage: all.slice(-5000),
    });
    if (scoreBatchDiversity(drafts).score < (adsPerCustomer > 4 ? 0.6 : 0.65)) diversityFailures += 1;
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
      all.push(draft);
    }
  }
  const total = all.length;
  return {
    customers, adsPerCustomer, total, exactDuplicates, nearDuplicates,
    nearDuplicateRate: Number((nearDuplicates / total).toFixed(6)),
    semanticCollisionRate: Number((exactDuplicates / total).toFixed(6)),
    visualCollisionRate: Number(((total - visualKeys.size) / total).toFixed(6)),
    meaningfullyDistinctExecutions: visualKeys.size,
    rawVariantCapacity: "configuration-space exceeds simulated volume; not claimed as meaningful capacity",
    diversityFailures,
    familyDistribution: top(families, total), layoutDistribution: top(layouts, total), imageReuse: top(images, total),
  };
}

const capacity = [simulate(100, 3), simulate(100, 5), simulate(200, 5)];
const verticalQaConfigs = [CONFIGS[0], CONFIGS[1], CONFIGS[2], CONFIGS[3], CONFIGS[4], CONFIGS[11]];
const verticalQa = verticalQaConfigs.map(([vertical, audienceSegment, language], configIndex) => {
  const drafts: Array<Record<string, any>> = [];
  for (let batch = 0; batch < 20; batch++) drafts.push(...generateCreativeIntelligenceDrafts({
    vertical, audienceSegment, language, userKey: `vertical-qa-${configIndex}-${batch}`,
    campaignName: `Vertical QA ${vertical}`, requestedCount: 5,
    generationNonce: `vertical-qa-${vertical}-${audienceSegment}-${batch}`, recentUsage: drafts,
  }));
  return {
    vertical: `${vertical}/${audienceSegment}/${language}`, generated: drafts.length,
    exactSignatures: drafts.length - new Set(drafts.map((draft) => draft.semanticFingerprint)).size,
    layouts: new Set(drafts.map((draft) => draft.layoutId)).size,
    families: new Set(drafts.map((draft) => draft.winningFamilyId)).size,
  };
});

process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), capacity, verticalQa }, null, 2)}\n`);
