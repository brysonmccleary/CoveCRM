import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { Types } from "mongoose";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import CampaignActionLog from "@/models/CampaignActionLog";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const campaignId = String(req.query.campaignId || "").trim();
  if (!campaignId || !Types.ObjectId.isValid(campaignId)) {
    return res.status(400).json({ error: "Invalid campaignId" });
  }

  const campaign = await FBLeadCampaign.findOne({ _id: new Types.ObjectId(campaignId) })
    .select("_id userId userEmail")
    .lean();
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (String(campaign.userEmail || "").toLowerCase() !== email) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const logs = await CampaignActionLog.find({
    userId: campaign.userId,
    campaignId: campaign._id,
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const history = logs.map((log) => {
    const summary = (log.metaResponse as any)?.summary || {};
    return {
      action: log.actionType,
      reasoning: summary.reasoning || "",
      dryRun: !!summary.dryRun,
      oldBudget: log.oldBudget || 0,
      newBudget: log.newBudget || 0,
      createdAt: new Date(log.createdAt).toISOString(),
      metaResponseSummary: summary.message || "",
    };
  });

  return res.status(200).json({ history });
}
