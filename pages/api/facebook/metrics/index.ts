// pages/api/facebook/metrics/index.ts
// POST — submit daily metrics for a campaign
// GET  — fetch metrics for a campaign (with date range)
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import AdMetricsDaily from "@/models/AdMetricsDaily";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";
import { scoreAdPerformance } from "@/lib/facebook/scoreAdPerformance";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  await mongooseConnect();

  const userEmail = session.user.email.toLowerCase();
  const user = await User.findOne({ email: userEmail }).select("_id").lean();
  if (!user) return res.status(401).json({ message: "User not found" });
  const userId = user._id;

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { campaignId, startDate, endDate, limit = "30" } = req.query;

    if (!campaignId) {
      return res.status(400).json({ message: "campaignId is required" });
    }

    // Verify ownership
    const campaign = await FBLeadCampaign.findOne({ _id: campaignId, userId }).lean();
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    const filter: Record<string, any> = { campaignId, userId };
    if (startDate) filter.date = { $gte: startDate };
    if (endDate) filter.date = { ...filter.date, $lte: endDate };

    const metrics = await AdMetricsDaily.find(filter)
      .sort({ date: -1 })
      .limit(Number(limit))
      .lean();

    return res.status(200).json({ ok: true, metrics });
  }

  // ── POST ─────────────────────────────────────────────────────────────────────
  if (req.method === "POST") {
    const {
      campaignId,
      date,
      spend,
      impressions,
      clicks,
      leads,
      reach,
      frequency,
      notes,
    } = req.body as {
      campaignId: string;
      date: string;
      spend?: number;
      impressions?: number;
      clicks?: number;
      leads?: number;
      reach?: number;
      frequency?: number;
      notes?: string;
    };

    if (!campaignId || !date) {
      return res.status(400).json({ message: "campaignId and date are required" });
    }

    // Verify ownership
    const campaign = await FBLeadCampaign.findOne({ _id: campaignId, userId }).lean();
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    // Derive computed fields
    const cpl = leads && spend && leads > 0 ? spend / leads : 0;
    const ctr = impressions && clicks && impressions > 0 ? (clicks / impressions) * 100 : 0;

    const doc = await AdMetricsDaily.findOneAndUpdate(
      { campaignId, userId, date },
      {
        $set: {
          campaignId,
          userId,
          userEmail,
          date,
          spend: spend ?? 0,
          impressions: impressions ?? 0,
          clicks: clicks ?? 0,
          leads: leads ?? 0,
          reach: reach ?? 0,
          frequency: frequency ?? 0,
          cpl,
          ctr,
          notes: notes ?? "",
        },
      },
      { upsert: true, new: true }
    );

    // Re-score campaign after metrics update
    scoreAdPerformance(String(campaignId)).catch(() => {});

    return res.status(200).json({ ok: true, metrics: doc });
  }

  return res.status(405).json({ message: "Method not allowed" });
}
