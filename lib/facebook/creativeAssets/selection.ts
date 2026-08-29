import { createHash } from "crypto";
import type { AssetSelectionContext, ProductionCreativeAsset } from "./types";

const SAFE_LICENSES = new Set(["owned", "licensed", "approved_stock"]);

function includesOrWildcard(values: string[], expected: string): boolean {
  return values.includes("*") || values.includes(expected);
}

function isCurrent(value: string | Date | null | undefined, now: Date): boolean {
  return !value || new Date(value).getTime() > now.getTime();
}

function formatMatches(asset: ProductionCreativeAsset, requested: AssetSelectionContext["format"]): boolean {
  if (requested === "video" || requested === "ugc_video" || requested === "agent_video") {
    return asset.format === requested || (requested === "video" && ["ugc_video", "agent_video"].includes(asset.format));
  }
  return requested === "photo"
    ? ["photo", "texture"].includes(asset.format)
    : asset.format === "graphic" || asset.format === "texture";
}

export function isProductionAssetCompatible(
  asset: ProductionCreativeAsset,
  context: AssetSelectionContext,
  now = new Date()
): boolean {
  if (!asset.active || asset.approvalStatus !== "approved" || !SAFE_LICENSES.has(asset.licenseStatus)) return false;
  if (!asset.storageUrl || !asset.assetId || !asset.contentHash || !asset.visualFingerprint) return false;
  if (!asset.approvedAt || !isCurrent(asset.expiresAt, now)) return false;
  if (!includesOrWildcard(asset.verticals, context.vertical)) return false;
  if (!includesOrWildcard(asset.audienceSegments, context.audienceSegment)) return false;
  if (!includesOrWildcard(asset.products, context.product)) return false;
  if (!includesOrWildcard(asset.languages, context.language)) return false;
  if (!includesOrWildcard(asset.layoutCompatibility, context.layoutId)) return false;
  if (!includesOrWildcard(asset.compatibleFamilies, context.familyId)) return false;
  if (!formatMatches(asset, context.format)) return false;
  if (context.excludedAssetIds?.has(asset.assetId)) return false;
  return true;
}

function stableJitter(seed: string, assetId: string): number {
  const value = parseInt(createHash("sha256").update(`${seed}|${assetId}`).digest("hex").slice(0, 8), 16) >>> 0;
  return 0.9 + (value % 2_001) / 10_000;
}

export function scoreProductionAsset(asset: ProductionCreativeAsset, context: AssetSelectionContext): number {
  const usage = context.recentUsage || [];
  const globalRecent = usage.filter((row: any) => row?.assetId === asset.assetId).length;
  const accountRecent = usage.filter((row: any) => row?.assetId === asset.assetId && row?.userEmail === context.userKey).length;
  const familyRecent = usage.filter((row: any) => row?.assetId === asset.assetId && row?.winningFamilyId === context.familyId).length;
  const layoutRecent = usage.filter((row: any) => row?.assetId === asset.assetId && row?.layoutId === context.layoutId).length;
  const fingerprintRecent = usage.filter((row: any) => row?.assetVisualFingerprint === asset.visualFingerprint).length;
  const lifetimePenalty = 1 / Math.sqrt(1 + Math.max(0, Number(asset.useCount || 0)));
  const recentPenalty = 1 / (1 + globalRecent * 0.5 + accountRecent * 2 + familyRecent + layoutRecent * 0.75 + fingerprintRecent * 1.5);
  return lifetimePenalty * recentPenalty * stableJitter(context.seed, asset.assetId);
}

export function selectProductionAsset(
  assets: ProductionCreativeAsset[],
  context: AssetSelectionContext,
  now = new Date()
): ProductionCreativeAsset | null {
  const eligible = assets.filter((asset) => isProductionAssetCompatible(asset, context, now));
  if (!eligible.length) return null;
  return eligible
    .map((asset) => ({ asset, score: scoreProductionAsset(asset, context) }))
    .sort((left, right) => right.score - left.score || left.asset.assetId.localeCompare(right.asset.assetId))[0].asset;
}
