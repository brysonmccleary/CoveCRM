import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import mongooseConnect from "@/lib/mongooseConnect";
import { generateAdBrainRecommendations } from "@/lib/ai/adBrain";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import CRMOutcome from "@/models/CRMOutcome";
import User from "@/models/User";

type OutcomeTotals = {
  appointmentsBooked: number;
  sales: number;
  revenue: number;
};

function emptyOutcome(): OutcomeTotals {
  return { appointmentsBooked: 0, sales: 0, revenue: 0 };
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return res.status(403).json({ error: 'Forbidden' });
  const userEmail = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const sessionUserId =
    typeof session?.user?.id === "string" && session.user.id.trim()
      ? session.user.id.trim()
      : "";
  const user = sessionUserId
    ? null
    : await User.findOne({ email: userEmail }).select("_id").lean();
  const userId = sessionUserId || ((user as any)?._id ? String((user as any)._id) : "");

  const userFilter: Record<string, any>[] = [{ userEmail }];
  if (userId) userFilter.push({ userId });

  const campaigns = await FBLeadCampaign.find({ $or: userFilter })
    .select({
      _id: 1,
      campaignName: 1,
      leadType: 1,
      status: 1,
      dailyBudget: 1,
      totalSpend: 1,
      totalLeads: 1,
      cpl: 1,
      targetCpl: 1,
      ctr: 1,
      frequency: 1,
      performanceScore: 1,
      performanceClass: 1,
      appointments: 1,
      sales: 1,
      revenue: 1,
      metaCampaignId: 1,
      metaAdsetId: 1,
      metaAdId: 1,
      createdAt: 1,
      lastAutomationActionAt: 1,
      metaPublishStatus: 1,
      metaObjectHealth: 1,
    })
    .lean();

  const internalIds = campaigns.map((campaign: any) => campaign._id).filter(Boolean);
  const metaIds = campaigns
    .map((campaign: any) => String(campaign.metaCampaignId || ""))
    .filter(Boolean);

  const outcomeMap = new Map<string, OutcomeTotals>();

  if (internalIds.length || metaIds.length) {
    const userOutcomeFilter: Record<string, any>[] = [{ userEmail }];
    if (userId) userOutcomeFilter.push({ userId });

    const outcomeRows = await CRMOutcome.aggregate([
      {
        $match: {
          $and: [
            { $or: userOutcomeFilter },
            {
              $or: [
                ...(internalIds.length ? [{ campaignId: { $in: internalIds } }] : []),
                ...(metaIds.length ? [{ metaCampaignId: { $in: metaIds } }] : []),
              ],
            },
          ],
        },
      },
      {
        $group: {
          _id: {
            campaignId: "$campaignId",
            metaCampaignId: "$metaCampaignId",
          },
          appointmentsBooked: { $sum: "$appointmentsBooked" },
          sales: { $sum: "$sales" },
          revenue: { $sum: "$revenue" },
        },
      },
    ]);

    for (const row of outcomeRows as any[]) {
      const totals = {
        appointmentsBooked: num(row.appointmentsBooked),
        sales: num(row.sales),
        revenue: num(row.revenue),
      };
      const internalKey = row?._id?.campaignId ? String(row._id.campaignId) : "";
      const metaKey = row?._id?.metaCampaignId ? String(row._id.metaCampaignId) : "";
      if (internalKey) outcomeMap.set(internalKey, totals);
      if (metaKey) outcomeMap.set(metaKey, totals);
    }
  }

  const summaries = campaigns.map((campaign: any) => {
    const internalKey = String(campaign._id || "");
    const metaKey = String(campaign.metaCampaignId || "");
    const outcome = outcomeMap.get(metaKey) || outcomeMap.get(internalKey) || emptyOutcome();

    return {
      _id: internalKey,
      campaignName: campaign.campaignName,
      leadType: campaign.leadType,
      status: campaign.status,
      dailyBudget: num(campaign.dailyBudget),
      totalSpend: num(campaign.totalSpend),
      totalLeads: num(campaign.totalLeads),
      cpl: num(campaign.cpl),
      targetCpl: num(campaign.targetCpl),
      ctr: num(campaign.ctr),
      frequency: num(campaign.frequency),
      performanceScore: num(campaign.performanceScore),
      performanceClass: campaign.performanceClass,
      appointmentsBooked: outcome.appointmentsBooked || num(campaign.appointments),
      sales: outcome.sales || num(campaign.sales),
      revenue: outcome.revenue,
      metaCampaignId: campaign.metaCampaignId || "",
      metaAdsetId: campaign.metaAdsetId || "",
      metaAdId: campaign.metaAdId || "",
      createdAt: campaign.createdAt,
      lastAutomationActionAt: campaign.lastAutomationActionAt,
      metaPublishStatus: campaign.metaPublishStatus,
      metaObjectHealth: campaign.metaObjectHealth,
    };
  });

  const result = await generateAdBrainRecommendations({
    campaigns: summaries,
    accountContext: {
      userEmail,
      campaignCount: summaries.length,
      advisoryOnly: true,
    },
  });

  return res.status(200).json({
    ok: true,
    mode: result.mode,
    recommendations: result.recommendations,
  });
}
