import dotenv from "dotenv";
import path from "path";
import mongoose from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import MetaCreativeAsset from "@/models/MetaCreativeAsset";
import MetaCreativeVideoFramework from "@/models/MetaCreativeVideoFramework";
import MetaProductCapability from "@/models/MetaProductCapability";
import MetaClaimApproval from "@/models/MetaClaimApproval";
import MetaClaimRegistry from "@/models/MetaClaimRegistry";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

async function main() {
  await mongooseConnect();
  const now = new Date();
  const [assets, productCapabilities, claimApprovals, claimRegistry, approvedVideoFrameworks, pendingVideoFrameworks] = await Promise.all([
    MetaCreativeAsset.find({}).select("assetId verticals audienceSegments languages format visualClass approvalStatus active useCount lastUsedAt -_id").lean(),
    MetaProductCapability.countDocuments({ active: true, effectiveDate: { $lte: now }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }),
    MetaClaimApproval.countDocuments({ revokedAt: null, expiresAt: { $gt: now } }),
    MetaClaimRegistry.countDocuments({ expiresAt: { $gt: now } }),
    MetaCreativeVideoFramework.countDocuments({ active: true, approvalStatus: "approved" }),
    MetaCreativeVideoFramework.countDocuments({ active: true, approvalStatus: "pending" }),
  ]);
  const approved = assets.filter((asset: any) => asset.active && asset.approvalStatus === "approved");
  const count = (predicate: (asset: any) => boolean) => approved.filter(predicate).length;
  console.log(JSON.stringify({
    generatedAt: now.toISOString(),
    assetsTotal: assets.length,
    assetsApprovedActive: approved.length,
    veteran: count((asset) => asset.verticals?.includes("veteran") && asset.audienceSegments?.includes("veteran") && asset.languages?.includes("en")),
    mortgage: count((asset) => asset.verticals?.includes("mortgage_protection") && asset.audienceSegments?.includes("standard") && asset.languages?.includes("en")),
    trucker: count((asset) => asset.verticals?.includes("trucker") && asset.audienceSegments?.includes("trucker") && asset.languages?.includes("en")),
    finalExpenseStandard: count((asset) => asset.verticals?.includes("final_expense") && asset.audienceSegments?.includes("standard") && asset.languages?.includes("en")),
    iulStandard: count((asset) => asset.verticals?.includes("iul") && asset.audienceSegments?.includes("standard") && asset.languages?.includes("en")),
    spanishNative: count((asset) => asset.languages?.includes("es")),
    videos: count((asset) => ["video", "ugc_video", "agent_video"].includes(asset.format)),
    approvedVideoFrameworks,
    pendingVideoFrameworks,
    productCapabilities,
    claimApprovals,
    currentClaimRegistryEntries: claimRegistry,
    recordedPublishedUses: approved.reduce((sum: number, asset: any) => sum + Number(asset.useCount || 0), 0),
    maximumAssetUseCount: Math.max(0, ...approved.map((asset: any) => Number(asset.useCount || 0))),
    directionCounts: Object.fromEntries([...new Set(approved.map((asset: any) => asset.visualClass))]
      .map((visualClass) => [visualClass, approved.filter((asset: any) => asset.visualClass === visualClass).length])),
  }, null, 2));
  await mongoose.disconnect();
}

main().catch((error) => { console.error(error); process.exit(1); });
