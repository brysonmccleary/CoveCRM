import dotenv from "dotenv";
import path from "path";
import mongooseConnect from "@/lib/mongooseConnect";
import MetaCreativeAsset from "@/models/MetaCreativeAsset";
import { generateCreativeIntelligenceDrafts, scoreBatchDiversity } from "@/lib/facebook/creativeIntelligence/engine";
import { creativeSimilarity } from "@/lib/facebook/creativeIntelligence/similarity";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const CONFIGS = [
  ["veteran", "veteran", "en"], ["final_expense", "standard", "en"],
  ["mortgage_protection", "standard", "en"], ["iul", "standard", "en"], ["trucker", "trucker", "en"],
  ["mortgage_protection", "veteran", "en"], ["iul", "veteran", "en"], ["final_expense", "veteran", "en"],
  ["mortgage_protection", "trucker", "en"], ["iul", "trucker", "en"], ["final_expense", "trucker", "en"],
  ["final_expense", "spanish", "es"], ["mortgage_protection", "spanish", "es"], ["iul", "spanish", "es"],
] as const;

function increment(map: Map<string, number>, value: unknown) {
  const key = String(value || "none");
  map.set(key, (map.get(key) || 0) + 1);
}

function distribution(map: Map<string, number>, total: number) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count, share: Number((count / Math.max(1, total)).toFixed(4)) }));
}

function simulate(productionAssets: any[], customers: number, adsPerCustomer: number) {
  const all: any[] = [];
  const failures: Array<{ customer: number; combination: string; error: string }> = [];
  const assets = new Map<string, number>();
  const families = new Map<string, number>();
  const layouts = new Map<string, number>();
  const headlines = new Map<string, number>();
  const offers = new Map<string, number>();
  const selectors = new Map<string, number>();
  let exactDuplicates = 0;
  let nearDuplicates = 0;
  let diversityFailures = 0;
  let actualAssetBacked = 0;
  for (let customer = 0; customer < customers; customer++) {
    const [vertical, audienceSegment, language] = CONFIGS[customer % CONFIGS.length];
    let drafts: any[];
    try {
      drafts = generateCreativeIntelligenceDrafts({
        vertical, audienceSegment, language, userKey: `actual-capacity-${customer}@example.invalid`,
        campaignName: `Actual Asset Capacity ${customer}`, requestedCount: adsPerCustomer,
        generationNonce: `actual-${customers}-${adsPerCustomer}-${customer}`,
        recentUsage: all.slice(-5000), productionAssets,
      });
    } catch (error: any) {
      failures.push({ customer, combination: `${vertical}/${audienceSegment}/${language}`, error: String(error?.message || error) });
      continue;
    }
    if (scoreBatchDiversity(drafts).score < (adsPerCustomer > 4 ? 0.72 : 0.8)) diversityFailures += 1;
    for (const draft of drafts) {
      const comparisons = all.slice(-5000);
      if (comparisons.some((row) => row.semanticFingerprint === draft.semanticFingerprint)) exactDuplicates += 1;
      if (comparisons.some((row) => creativeSimilarity(draft, row).classification === "NEAR_DUPLICATE")) nearDuplicates += 1;
      if (draft.assetId) actualAssetBacked += 1;
      increment(assets, draft.assetId);
      increment(families, draft.winningFamilyId);
      increment(layouts, draft.layoutId);
      increment(headlines, draft.headline);
      increment(offers, draft.offerClass);
      increment(selectors, JSON.stringify(draft.selectorContract || {}));
      all.push(draft);
    }
  }
  const expected = customers * adsPerCustomer;
  const assetDistribution = distribution(assets, all.length).filter((row) => row.key !== "none");
  const assetCoverage = actualAssetBacked / expected;
  const maxSingleAssetShare = assetDistribution[0]?.count / Math.max(1, expected) || 0;
  return {
    customers, adsPerCustomer, expectedAds: expected, generatedAds: all.length,
    generationFailures: failures.length, firstFailures: failures.slice(0, 10), diversityFailures,
    actualAssetBacked, actualAssetCoverage: Number(assetCoverage.toFixed(4)),
    exactDuplicates, nearDuplicates,
    maxSingleAssetShare: Number(maxSingleAssetShare.toFixed(4)),
    pass: failures.length === 0 && all.length === expected && assetCoverage === 1
      && exactDuplicates === 0 && nearDuplicates === 0 && maxSingleAssetShare <= 0.05,
    assetReuse: assetDistribution.slice(0, 20),
    familyDistribution: distribution(families, all.length).slice(0, 20),
    layoutDistribution: distribution(layouts, all.length).slice(0, 20),
    headlineDistribution: distribution(headlines, all.length).slice(0, 20),
    offerDistribution: distribution(offers, all.length).slice(0, 20),
    selectorDistribution: distribution(selectors, all.length).slice(0, 20),
  };
}

async function main() {
  await mongooseConnect();
  const assets = await MetaCreativeAsset.find({ active: true, approvalStatus: "approved", licenseStatus: { $in: ["owned", "licensed", "approved_stock"] } })
    .select("assetId assetType verticals audienceSegments products languages format direction imageDirection visualClass compatibleFamilies layoutCompatibility storageUrl contentHash semanticFingerprint visualFingerprint ownershipStatus licenseStatus approvalStatus approvedAt expiresAt useCount recentUsage lastUsedAt active -_id")
    .lean();
  const results = [simulate(assets as any[], 100, 3), simulate(assets as any[], 100, 5), simulate(assets as any[], 200, 5)];
  const outputResults = process.argv.includes("--summary") ? results.map((result) => ({
    customers: result.customers, adsPerCustomer: result.adsPerCustomer, expectedAds: result.expectedAds,
    generatedAds: result.generatedAds, generationFailures: result.generationFailures,
    diversityFailures: result.diversityFailures, actualAssetBacked: result.actualAssetBacked,
    actualAssetCoverage: result.actualAssetCoverage, exactDuplicates: result.exactDuplicates,
    nearDuplicates: result.nearDuplicates, maxSingleAssetShare: result.maxSingleAssetShare, pass: result.pass,
    firstFailures: result.firstFailures.slice(0, 3),
  })) : results;
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), actualApprovedAssetPool: assets.length, results: outputResults }, null, 2));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
