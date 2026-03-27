// pages/api/facebook/outcomes/index.ts
// GET  — fetch CRM outcomes for a campaign
// POST — manually record a CRM outcome
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import CRMOutcome from "@/models/CRMOutcome";
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
    const { campaignId, startDate, endDate, aggregate } = req.query;

    if (!campaignId) {
      return res.status(400).json({ message: "campaignId is required" });
    }

    const campaign = await FBLeadCampaign.findOne({ _id: campaignId, userId }).lean();
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    const filter: Record<string, any> = { campaignId, userId };
    if (startDate) filter.date = { $gte: startDate };
    if (endDate) filter.date = { ...filter.date, $lte: endDate };

    if (aggregate === "1") {
      const agg = await CRMOutcome.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            appointmentsBooked: { $sum: "$appointmentsBooked" },
            appointmentsShowed: { $sum: "$appointmentsShowed" },
            sales: { $sum: "$sales" },
            revenue: { $sum: "$revenue" },
            notInterested: { $sum: "$notInterested" },
            badNumbers: { $sum: "$badNumbers" },
            optOuts: { $sum: "$optOuts" },
          },
        },
      ]);
      return res.status(200).json({ ok: true, totals: agg[0] || {} });
    }

    const outcomes = await CRMOutcome.find(filter).sort({ date: -1 }).limit(90).lean();
    return res.status(200).json({ ok: true, outcomes });
  }

  // ── POST ─────────────────────────────────────────────────────────────────────
  if (req.method === "POST") {
    const {
      campaignId,
      date,
      appointmentsBooked,
      appointmentsShowed,
      sales,
      revenue,
      notInterested,
      badNumbers,
      optOuts,
    } = req.body as {
      campaignId: string;
      date: string;
      appointmentsBooked?: number;
      appointmentsShowed?: number;
      sales?: number;
      revenue?: number;
      notInterested?: number;
      badNumbers?: number;
      optOuts?: number;
    };

    if (!campaignId || !date) {
      return res.status(400).json({ message: "campaignId and date are required" });
    }

    const campaign = await FBLeadCampaign.findOne({ _id: campaignId, userId }).lean();
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    const doc = await CRMOutcome.findOneAndUpdate(
      { campaignId, userId, date },
      {
        $set: {
          campaignId,
          userId,
          userEmail,
          date,
          appointmentsBooked: appointmentsBooked ?? 0,
          appointmentsShowed: appointmentsShowed ?? 0,
          sales: sales ?? 0,
          revenue: revenue ?? 0,
          notInterested: notInterested ?? 0,
          badNumbers: badNumbers ?? 0,
          optOuts: optOuts ?? 0,
        },
      },
      { upsert: true, new: true }
    );

    scoreAdPerformance(String(campaignId)).catch(() => {});

    return res.status(200).json({ ok: true, outcome: doc });
  }

  return res.status(405).json({ message: "Method not allowed" });
}
