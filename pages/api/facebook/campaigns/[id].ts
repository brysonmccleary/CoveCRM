// pages/api/facebook/campaigns/[id].ts
// GET, PATCH, DELETE for a specific FB lead campaign
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query as { id: string };

  await mongooseConnect();

  const campaign = await FBLeadCampaign.findOne({
    _id: id,
    userEmail: session.user.email.toLowerCase(),
  });

  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (req.method === "GET") {
    return res.status(200).json({ campaign });
  }

  if (req.method === "PATCH") {
    const { campaignName, status, dailyBudget, totalSpend, totalLeads, totalClicks, cpl, notes, facebookCampaignId } =
      req.body as Partial<{
        campaignName: string;
        status: string;
        dailyBudget: number;
        totalSpend: number;
        totalLeads: number;
        totalClicks: number;
        cpl: number;
        notes: string;
        facebookCampaignId: string;
      }>;

    const updates: Record<string, any> = {};
    if (campaignName !== undefined) updates.campaignName = campaignName;
    if (status !== undefined) updates.status = status;
    if (dailyBudget !== undefined) updates.dailyBudget = dailyBudget;
    if (totalSpend !== undefined) updates.totalSpend = totalSpend;
    if (totalLeads !== undefined) updates.totalLeads = totalLeads;
    if (totalClicks !== undefined) updates.totalClicks = totalClicks;
    if (cpl !== undefined) updates.cpl = cpl;
    if (notes !== undefined) updates.notes = notes;
    if (facebookCampaignId !== undefined) updates.facebookCampaignId = facebookCampaignId;

    if (status === "active" && !campaign.setupCompletedAt) {
      updates.setupCompletedAt = new Date();
      updates.connectedAt = new Date();
    }

    Object.assign(campaign, updates);
    await campaign.save();

    return res.status(200).json({ ok: true, campaign });
  }

  if (req.method === "DELETE") {
    await campaign.deleteOne();
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
