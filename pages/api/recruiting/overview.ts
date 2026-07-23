import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import { RECRUITING_PUBLIC_MESSAGES } from "@/lib/recruiting/public-errors";
import RecruitingCampaign from "@/models/RecruitingCampaign";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";
import RecruitingDiscoveryJob from "@/models/RecruitingDiscoveryJob";
import RecruitingProspect from "@/models/RecruitingProspect";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;
  res.setHeader("Cache-Control", "private, no-store");
  try {
    await mongooseConnect();
    const campaigns = await RecruitingCampaign.find({ ownerEmail: admin.email, executionMode: "hosted_cloud", status: { $ne: "archived" } })
      .sort({ createdAt: -1 }).limit(10).lean();
    const campaignIds = campaigns.map((campaign) => campaign._id);
    const [actionGroups, prospectGroups, discovery, recent] = await Promise.all([
      RecruitingCompanionJob.aggregate([
        { $match: { ownerEmail: admin.email, campaignId: { $in: campaignIds } } },
        { $group: { _id: { campaignId: "$campaignId", platform: "$platform", actionType: "$actionType", status: "$status" }, count: { $sum: 1 } } },
      ]),
      RecruitingProspect.aggregate([
        { $match: { ownerEmail: admin.email, campaignId: { $in: campaignIds } } },
        { $group: { _id: { campaignId: "$campaignId", confidenceTier: "$confidenceTier" }, count: { $sum: 1 } } },
      ]),
      RecruitingDiscoveryJob.find({ ownerEmail: admin.email, campaignId: { $in: campaignIds } })
        .select("campaignId platform lastCompletedAt lastCandidateCount lastError status availableAt").lean(),
      RecruitingCompanionJob.find({ ownerEmail: admin.email, campaignId: { $in: campaignIds }, status: { $in: ["succeeded", "skipped", "failed"] } })
        .sort({ completedAt: -1 }).limit(12)
        .select("campaignId platform actionType status resultSummary completedAt targetSnapshot.displayName").lean(),
    ]);
    const payload = campaigns.map((campaign) => {
      const id = String(campaign._id);
      const actions = actionGroups.filter((row) => String(row._id.campaignId) === id).map((row) => ({
        platform: row._id.platform,
        actionType: row._id.actionType,
        status: row._id.status,
        count: row.count,
      }));
      const prospects = prospectGroups.filter((row) => String(row._id.campaignId) === id).reduce((sum, row) => sum + row.count, 0);
      return {
        id,
        name: campaign.name,
        status: campaign.status,
        platforms: campaign.platforms,
        createdAt: campaign.createdAt,
        prospects,
        actions,
        discovery: discovery.filter((job) => String(job.campaignId) === id).map((job) => ({
          platform: job.platform,
          status: job.status,
          lastCompletedAt: job.lastCompletedAt,
          lastCandidateCount: job.lastCandidateCount,
          nextScanAt: job.availableAt,
          needsAttention: Boolean(job.lastError),
        })),
      };
    });
    return res.status(200).json({ campaigns: payload, recent: recent.map((job) => ({
      platform: job.platform,
      actionType: job.actionType,
      status: job.status,
      summary: job.resultSummary,
      completedAt: job.completedAt,
      displayName: job.targetSnapshot?.displayName || "Profile",
    })) });
  } catch {
    return res.status(503).json({ code: "CAMPAIGN_LOAD_FAILED", error: RECRUITING_PUBLIC_MESSAGES.CAMPAIGN_LOAD_FAILED });
  }
}
