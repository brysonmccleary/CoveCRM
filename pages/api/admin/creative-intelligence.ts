import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import MetaAdMetricsDaily from "@/models/MetaAdMetricsDaily";
import MetaProductCapability from "@/models/MetaProductCapability";
import MetaClaimRegistry from "@/models/MetaClaimRegistry";
import MetaCreativeAsset from "@/models/MetaCreativeAsset";
import MetaCreativeVideoFramework from "@/models/MetaCreativeVideoFramework";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user || (session.user as any).role !== "admin") return res.status(403).json({ error: "Forbidden" });
  await mongooseConnect();
  const [recent, distributions, metricCoverage, capabilityCount, claimCount, assetInventory, videoFrameworkCount] = await Promise.all([
    MetaCreativeUsage.find({}).sort({ createdAt: -1 }).limit(100)
      .select("status generationId reservationId expiresAt leadType winningFamilyId creativeClass layoutId hookClass headline cta imageIdentity imageDirection backgroundDirection offerClass selectorSchema semanticFingerprint visualFingerprint userEmail campaignId createdAt publishedAt")
      .lean(),
    MetaCreativeUsage.aggregate([
      { $match: { status: { $in: ["draft_reserved", "reserved", "published"] } } },
      { $group: { _id: { family: "$winningFamilyId", layout: "$layoutId", status: "$status" }, count: { $sum: 1 }, lastSeenAt: { $max: "$createdAt" } } },
      { $sort: { count: -1 } }, { $limit: 200 },
    ]),
    MetaAdMetricsDaily.aggregate([
      { $group: { _id: null, rows: { $sum: 1 }, ads: { $addToSet: "$metaAdId" }, families: { $addToSet: "$creativeFamily" }, layouts: { $addToSet: "$layoutId" }, qualifiedOutcomes: { $sum: "$qualifiedLeads" }, appointments: { $sum: "$appointmentsBooked" }, sales: { $sum: "$sales" } } },
    ]),
    MetaProductCapability.countDocuments({ active: true }),
    MetaClaimRegistry.countDocuments({ expiresAt: { $gt: new Date() } }),
    MetaCreativeAsset.aggregate([
      { $group: { _id: { approvalStatus: "$approvalStatus", format: "$format", language: "$languages", vertical: "$verticals" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    MetaCreativeVideoFramework.countDocuments({ approvalStatus: "approved", active: true }),
  ]);
  return res.status(200).json({
    ok: true,
    generatedAt: new Date().toISOString(),
    recent,
    distributions,
    performanceCoverage: metricCoverage[0] || { rows: 0, ads: [], families: [], layouts: [], qualifiedOutcomes: 0, appointments: 0, sales: 0 },
    activeProductCapabilities: capabilityCount,
    currentClaimRegistryEntries: claimCount,
    assetInventory,
    approvedVideoFrameworks: videoFrameworkCount,
  });
}
