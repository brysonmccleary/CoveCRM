// pages/api/facebook/ad-performance.ts
// Returns campaign-level performance metrics for the Ads Copilot.
// Aggregates from AdMetricsDaily (which is kept current by syncAdInsights).
// Also returns FBLeadCampaign totals for quick reference.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import AdMetricsDaily from "@/models/AdMetricsDaily";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const sub = await FBLeadSubscription.findOne({
    userEmail: session.user.email.toLowerCase(),
    status: { $in: ["active", "trialing"] },
  }).lean();
  if (!sub) return res.status(403).json({ error: "FB Lead Manager subscription required" });

  const email = session.user.email.toLowerCase();
  const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || "30"), 10)));

  // Date range
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];

  // All campaigns for this user
  const campaigns = await FBLeadCampaign.find({ userEmail: email })
    .sort({ createdAt: -1 })
    .lean() as any[];

  if (campaigns.length === 0) {
    return res.status(200).json({ ok: true, campaigns: [], summary: { totalSpend: 0, totalLeads: 0, avgCpl: 0 } });
  }

  const campaignIds = campaigns.map((c: any) => c._id);

  // Aggregate daily metrics for this date range
  const dailyMetrics = await AdMetricsDaily.find({
    campaignId: { $in: campaignIds },
    date: { $gte: sinceStr },
  }).lean() as any[];

  // Group by campaignId
  const metricsByCampaignId = new Map<string, {
    spend: number;
    leads: number;
    clicks: number;
    impressions: number;
    appointmentsBooked: number;
    appointmentsShowed: number;
    sales: number;
    revenue: number;
    notInterested: number;
    badNumbers: number;
    optOuts: number;
  }>();

  for (const m of dailyMetrics) {
    const cid = String(m.campaignId);
    const prev = metricsByCampaignId.get(cid) || {
      spend: 0,
      leads: 0,
      clicks: 0,
      impressions: 0,
      appointmentsBooked: 0,
      appointmentsShowed: 0,
      sales: 0,
      revenue: 0,
      notInterested: 0,
      badNumbers: 0,
      optOuts: 0,
    };

    metricsByCampaignId.set(cid, {
      spend: prev.spend + (m.spend || 0),
      leads: prev.leads + (m.leads || 0),
      clicks: prev.clicks + (m.clicks || 0),
      impressions: prev.impressions + (m.impressions || 0),
      appointmentsBooked: prev.appointmentsBooked + (m.appointmentsBooked || 0),
      appointmentsShowed: prev.appointmentsShowed + (m.appointmentsShowed || 0),
      sales: prev.sales + (m.sales || 0),
      revenue: prev.revenue + (m.revenue || 0),
      notInterested: prev.notInterested + (m.notInterested || 0),
      badNumbers: prev.badNumbers + (m.badNumbers || 0),
      optOuts: prev.optOuts + (m.optOuts || 0),
    });
  }

  // Build enriched campaign list
  const enriched = campaigns.map((c: any) => {
    const cid = String(c._id);
    const periodMetrics = metricsByCampaignId.get(cid) || {
      spend: 0,
      leads: 0,
      clicks: 0,
      impressions: 0,
      appointmentsBooked: 0,
      appointmentsShowed: 0,
      sales: 0,
      revenue: 0,
      notInterested: 0,
      badNumbers: 0,
      optOuts: 0,
    };

    const periodCpl = periodMetrics.leads > 0 && periodMetrics.spend > 0
      ? periodMetrics.spend / periodMetrics.leads
      : 0;

    const ctr = periodMetrics.impressions > 0
      ? (periodMetrics.clicks / periodMetrics.impressions) * 100
      : 0;

    const costPerBooked = periodMetrics.appointmentsBooked > 0 && periodMetrics.spend > 0
      ? periodMetrics.spend / periodMetrics.appointmentsBooked
      : 0;

    const costPerShow = periodMetrics.appointmentsShowed > 0 && periodMetrics.spend > 0
      ? periodMetrics.spend / periodMetrics.appointmentsShowed
      : 0;

    const costPerSale = periodMetrics.sales > 0 && periodMetrics.spend > 0
      ? periodMetrics.spend / periodMetrics.sales
      : 0;

    const roas = periodMetrics.spend > 0 && periodMetrics.revenue > 0
      ? periodMetrics.revenue / periodMetrics.spend
      : 0;

    return {
      id: cid,
      campaignName: c.campaignName,
      leadType: c.leadType,
      status: c.status,
      dailyBudget: c.dailyBudget || 0,
      performanceScore: c.performanceScore ?? null,
      performanceClass: c.performanceClass ?? null,
      frequency: c.frequency || 0,
      optOutRate: c.optOutRate || 0,
      badNumberRate: c.badNumberRate || 0,
      // All-time totals from FBLeadCampaign (updated by syncAdInsights)
      totalSpend: c.totalSpend || 0,
      totalLeads: c.totalLeads || 0,
      cpl: c.cpl || 0,
      // Period-specific metrics from AdMetricsDaily
      period: {
        days,
        spend: Math.round(periodMetrics.spend * 100) / 100,
        leads: periodMetrics.leads,
        clicks: periodMetrics.clicks,
        impressions: periodMetrics.impressions,
        appointmentsBooked: periodMetrics.appointmentsBooked,
        appointmentsShowed: periodMetrics.appointmentsShowed,
        sales: periodMetrics.sales,
        revenue: Math.round(periodMetrics.revenue * 100) / 100,
        notInterested: periodMetrics.notInterested,
        badNumbers: periodMetrics.badNumbers,
        optOuts: periodMetrics.optOuts,
        cpl: Math.round(periodCpl * 100) / 100,
        ctr: Math.round(ctr * 100) / 100,
        costPerBooked: Math.round(costPerBooked * 100) / 100,
        costPerShow: Math.round(costPerShow * 100) / 100,
        costPerSale: Math.round(costPerSale * 100) / 100,
        roas: Math.round(roas * 100) / 100,
      },
    };
  });

  // Summary
  const summarySpend = enriched.reduce((s, c) => s + c.period.spend, 0);
  const summaryLeads = enriched.reduce((s, c) => s + c.period.leads, 0);
  const summaryBooked = enriched.reduce((s, c) => s + c.period.appointmentsBooked, 0);
  const summaryShowed = enriched.reduce((s, c) => s + c.period.appointmentsShowed, 0);
  const summarySales = enriched.reduce((s, c) => s + c.period.sales, 0);
  const summaryRevenue = enriched.reduce((s, c) => s + c.period.revenue, 0);

  const avgCpl = summaryLeads > 0 && summarySpend > 0 ? summarySpend / summaryLeads : 0;
  const avgCostPerBooked = summaryBooked > 0 && summarySpend > 0 ? summarySpend / summaryBooked : 0;
  const avgCostPerSale = summarySales > 0 && summarySpend > 0 ? summarySpend / summarySales : 0;
  const roas = summarySpend > 0 && summaryRevenue > 0 ? summaryRevenue / summarySpend : 0;

  return res.status(200).json({
    ok: true,
    campaigns: enriched,
    summary: {
      totalSpend: Math.round(summarySpend * 100) / 100,
      totalLeads: summaryLeads,
      totalBooked: summaryBooked,
      totalShowed: summaryShowed,
      totalSales: summarySales,
      totalRevenue: Math.round(summaryRevenue * 100) / 100,
      avgCpl: Math.round(avgCpl * 100) / 100,
      avgCostPerBooked: Math.round(avgCostPerBooked * 100) / 100,
      avgCostPerSale: Math.round(avgCostPerSale * 100) / 100,
      roas: Math.round(roas * 100) / 100,
      days,
    },
  });
}
