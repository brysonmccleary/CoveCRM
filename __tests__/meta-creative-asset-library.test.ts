import { buildUnfundedStaticAssetQueue, MASS_ASSET_COST_PLAN } from "@/lib/facebook/creativeAssets/productionPlan";
import { isProductionAssetCompatible, scoreProductionAsset, selectProductionAsset } from "@/lib/facebook/creativeAssets/selection";
import { buildPendingVideoFrameworks } from "@/lib/facebook/creativeAssets/videoFrameworks";
import { generateCreativeIntelligenceDrafts } from "@/lib/facebook/creativeIntelligence";

function asset(overrides: Record<string, any> = {}) {
  return {
    assetId: "asset-1", assetType: "LIFESTYLE", verticals: ["veteran"], audienceSegments: ["veteran"],
    products: ["veteran"], languages: ["en"], format: "photo", direction: "veteran at home",
    imageDirection: "veteran at home", visualClass: "veteran_lifestyle", compatibleFamilies: ["*"],
    layoutCompatibility: ["*"], storageUrl: "/assets/veteran-1.jpg", contentHash: "content-1",
    semanticFingerprint: "semantic-1", visualFingerprint: "visual-1", ownershipStatus: "owned",
    licenseStatus: "owned", approvalStatus: "approved", approvedAt: "2026-08-29", expiresAt: null,
    useCount: 0, recentUsage: 0, active: true, ...overrides,
  } as any;
}

const context = {
  vertical: "veteran", audienceSegment: "veteran", language: "en", product: "veteran",
  familyId: "VET_IDENTITY_AGE_AMOUNT_CORE", layoutId: "portrait_hero_offer", format: "photo",
  userKey: "agent@example.com", seed: "asset-selection", recentUsage: [],
} as const;

describe("production creative asset library", () => {
  it("fails closed for unapproved, unlicensed, expired, or incompatible assets", () => {
    expect(isProductionAssetCompatible(asset(), context as any)).toBe(true);
    expect(isProductionAssetCompatible(asset({ approvalStatus: "pending" }), context as any)).toBe(false);
    expect(isProductionAssetCompatible(asset({ licenseStatus: "unknown" }), context as any)).toBe(false);
    expect(isProductionAssetCompatible(asset({ expiresAt: "2020-01-01" }), context as any)).toBe(false);
    expect(isProductionAssetCompatible(asset({ languages: ["es"] }), context as any)).toBe(false);
    expect(isProductionAssetCompatible(asset({ products: ["iul"] }), context as any)).toBe(false);
  });

  it("diminishes probability after global, account, family, and layout reuse", () => {
    const fresh = asset({ assetId: "fresh", visualFingerprint: "fresh-v" });
    const repeated = asset({ assetId: "repeated", visualFingerprint: "repeat-v", useCount: 25 });
    const usage = Array.from({ length: 5 }, () => ({ assetId: "repeated", assetVisualFingerprint: "repeat-v", userEmail: context.userKey, winningFamilyId: context.familyId, layoutId: context.layoutId }));
    expect(scoreProductionAsset(repeated, { ...context, recentUsage: usage } as any))
      .toBeLessThan(scoreProductionAsset(fresh, { ...context, recentUsage: usage } as any));
    expect(selectProductionAsset([repeated, fresh], { ...context, recentUsage: usage } as any)?.assetId).toBe("fresh");
  });

  it("uses an actual compatible production asset ID and URL in generated drafts", () => {
    const productionAssets = [asset({ compatibleFamilies: ["VET_IDENTITY_AGE_AMOUNT_CORE"] })];
    const draft = generateCreativeIntelligenceDrafts({
      vertical: "veteran", audienceSegment: "veteran", language: "en", userKey: context.userKey,
      campaignName: "Asset QA", requestedCount: 1, generationNonce: "asset-backed-draft",
      preferredFamilyId: "VET_IDENTITY_AGE_AMOUNT_CORE", productionAssets,
    })[0];
    expect(draft).toEqual(expect.objectContaining({ assetId: "asset-1", imageUrl: "/assets/veteran-1.jpg", imageIdentity: "/assets/veteran-1.jpg" }));
  });

  it("creates an unfunded 740-image queue and 100 safe video frameworks without vendor calls", () => {
    const queue = buildUnfundedStaticAssetQueue();
    expect(MASS_ASSET_COST_PLAN.totalApprovedAssetsRequested).toBe(860);
    expect(MASS_ASSET_COST_PLAN.existingAssetCandidates).toBe(120);
    expect(queue).toHaveLength(740);
    expect(new Set(queue.map((job) => job.jobId)).size).toBe(740);
    const video = buildPendingVideoFrameworks();
    expect(video).toHaveLength(100);
    expect(video.every((framework) => framework.approvalStatus === "pending" && framework.claimRequirements.length === 0)).toBe(true);
  });
});
