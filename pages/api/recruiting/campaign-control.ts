import type { NextApiRequest, NextApiResponse } from "next";
import { Types } from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import { RecruitingPublicError, recruitingErrorPayload } from "@/lib/recruiting/public-errors";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCampaign from "@/models/RecruitingCampaign";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";
import RecruitingDiscoveryJob from "@/models/RecruitingDiscoveryJob";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;
  const campaignId = String(req.body?.campaignId || "");
  const operation = String(req.body?.operation || "");
  if (!Types.ObjectId.isValid(campaignId) || !["pause", "resume", "archive"].includes(operation)) {
    return res.status(400).json({ code: "CAMPAIGN_INPUT_INVALID", error: "Choose a valid campaign action." });
  }
  try {
    await mongooseConnect();
    const campaign = await RecruitingCampaign.findOne({ _id: campaignId, ownerEmail: admin.email, executionMode: "hosted_cloud" });
    if (!campaign) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "That campaign is no longer available.");
    const now = new Date();
    if (operation === "pause") {
      if (campaign.status !== "active") throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Only a running campaign can be paused.");
      campaign.status = "paused";
      await Promise.all([
        campaign.save(),
        RecruitingDiscoveryJob.updateMany({ campaignId: campaign._id, status: { $in: ["queued", "claimed"] } }, { $set: { status: "paused", leaseExpiresAt: null } }),
        RecruitingCompanionJob.updateMany({ campaignId: campaign._id, status: { $in: ["queued", "claimed"] } }, { $set: { status: "blocked", completedAt: now, leaseExpiresAt: null, failureCode: "campaign_paused", resultSummary: "Campaign paused by its owner." } }),
      ]);
    } else if (operation === "resume") {
      if (campaign.status !== "paused") throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Only a paused campaign can be resumed.");
      campaign.status = "active";
      await Promise.all([
        campaign.save(),
        RecruitingDiscoveryJob.updateMany({ campaignId: campaign._id, status: "paused" }, { $set: { status: "queued", availableAt: now, leaseExpiresAt: null } }),
        RecruitingCompanionJob.updateMany({ campaignId: campaign._id, status: "blocked", failureCode: "campaign_paused" }, { $set: { status: "queued", completedAt: null, availableAt: now, leaseExpiresAt: null, failureCode: "", resultSummary: "" } }),
      ]);
    } else {
      campaign.status = "archived";
      campaign.liveExecutionEnabled = false;
      await Promise.all([
        campaign.save(),
        RecruitingDiscoveryJob.updateMany({ campaignId: campaign._id, status: { $in: ["queued", "claimed", "paused"] } }, { $set: { status: "paused", leaseExpiresAt: null } }),
        RecruitingCompanionJob.updateMany({ campaignId: campaign._id, status: { $in: ["queued", "claimed", "blocked"] } }, { $set: { status: "canceled", completedAt: now, leaseExpiresAt: null, failureCode: "campaign_archived", resultSummary: "Campaign permanently stopped by its owner." } }),
      ]);
    }
    await RecruitingAuditEvent.create({
      ownerEmail: admin.email,
      actorEmail: admin.email,
      eventType: operation === "resume" ? "companion_resumed" : "companion_paused",
      entityType: "campaign",
      entityId: `${campaign._id}:${operation}:${Date.now()}`,
      details: { operation, hostedCloud: true },
    });
    return res.status(200).json({ status: campaign.status });
  } catch (error) {
    return res.status(409).json(recruitingErrorPayload(error, "CAMPAIGN_START_FAILED"));
  }
}
