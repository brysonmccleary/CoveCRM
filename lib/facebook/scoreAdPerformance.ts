// lib/facebook/scoreAdPerformance.ts
// Performance scoring engine for FB campaigns
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import CRMOutcome from "@/models/CRMOutcome";
import AdMetricsDaily from "@/models/AdMetricsDaily";

export type PerformanceClass = "SCALE" | "DUPLICATE_TEST" | "MONITOR" | "FIX" | "PAUSE";

export interface ScoreResult {
  score: number;
  performanceClass: PerformanceClass;
  breakdown: {
    costPerBookedContrib: number;
    costPerShowContrib: number;
    costPerSaleContrib: number;
    ctrContrib: number;
    frequencyPenalty: number;
    optOutPenalty: number;
    badNumberPenalty: number;
  };
}

function classifyScore(score: number): PerformanceClass {
  if (score >= 90) return "SCALE";
  if (score >= 70) return "DUPLICATE_TEST";
  if (score >= 50) return "MONITOR";
  if (score >= 30) return "FIX";
  return "PAUSE";
}

/**
 * Score formula (max 550 raw, normalized to 0-100):
 * + (100 - min(costPerBooked, 100))   → max 100
 * + (150 - min(costPerShow, 150))     → max 150
 * + (300 - min(costPerSale, 300))     → max 300
 * + ctr * 10                          → unbounded bonus
 * - frequency * 5                     → penalty
 * - optOutRate * 5                    → penalty
 * - badNumberRate * 5                 → penalty
 * Capped 0-550, then normalized to 0-100
 */
function computeScore(params: {
  costPerBooked: number;
  costPerShow: number;
  costPerSale: number;
  ctr: number;
  frequency: number;
  optOutRate: number;
  badNumberRate: number;
}): ScoreResult {
  const costPerBookedContrib = 100 - Math.min(params.costPerBooked, 100);
  const costPerShowContrib = 150 - Math.min(params.costPerShow, 150);
  const costPerSaleContrib = 300 - Math.min(params.costPerSale, 300);
  const ctrContrib = params.ctr * 10;
  const frequencyPenalty = params.frequency * 5;
  const optOutPenalty = params.optOutRate * 5;
  const badNumberPenalty = params.badNumberRate * 5;

  const raw =
    costPerBookedContrib +
    costPerShowContrib +
    costPerSaleContrib +
    ctrContrib -
    frequencyPenalty -
    optOutPenalty -
    badNumberPenalty;

  const capped = Math.max(0, Math.min(550, raw));
  const score = Math.round((capped / 550) * 100);

  return {
    score,
    performanceClass: classifyScore(score),
    breakdown: {
      costPerBookedContrib,
      costPerShowContrib,
      costPerSaleContrib,
      ctrContrib,
      frequencyPenalty,
      optOutPenalty,
      badNumberPenalty,
    },
  };
}

/**
 * Score a single campaign by campaignId.
 * Aggregates recent CRM outcomes + ad metrics, computes score, saves back to campaign.
 */
export async function scoreAdPerformance(campaignId: string): Promise<ScoreResult | null> {
  await mongooseConnect();

  const campaign = await FBLeadCampaign.findById(campaignId).lean();
  if (!campaign) return null;

  // Aggregate CRM outcomes (all time)
  const outcomeAgg = await CRMOutcome.aggregate([
    { $match: { campaignId: campaign._id } },
    {
      $group: {
        _id: null,
        totalSpend: { $sum: 0 }, // will be pulled from metrics
        appointmentsBooked: { $sum: "$appointmentsBooked" },
        appointmentsShowed: { $sum: "$appointmentsShowed" },
        sales: { $sum: "$sales" },
        optOuts: { $sum: "$optOuts" },
        badNumbers: { $sum: "$badNumbers" },
      },
    },
  ]);

  // Aggregate ad metrics (all time)
  const metricsAgg = await AdMetricsDaily.aggregate([
    { $match: { campaignId: campaign._id } },
    {
      $group: {
        _id: null,
        totalSpend: { $sum: "$spend" },
        totalLeads: { $sum: "$leads" },
        totalClicks: { $sum: "$clicks" },
        totalImpressions: { $sum: "$impressions" },
        avgFrequency: { $avg: "$frequency" },
      },
    },
  ]);

  const outcomes = outcomeAgg[0] || {};
  const metrics = metricsAgg[0] || {};

  const totalSpend = metrics.totalSpend || (campaign as any).totalSpend || 0;
  const totalLeads = metrics.totalLeads || (campaign as any).totalLeads || 0;
  const totalClicks = metrics.totalClicks || (campaign as any).totalClicks || 0;
  const totalImpressions = metrics.totalImpressions || 0;
  const avgFrequency = metrics.avgFrequency || (campaign as any).frequency || 0;

  const appointmentsBooked = outcomes.appointmentsBooked || 0;
  const appointmentsShowed = outcomes.appointmentsShowed || 0;
  const sales = outcomes.sales || 0;
  const optOuts = outcomes.optOuts || 0;
  const badNumbers = outcomes.badNumbers || 0;

  const costPerBooked = appointmentsBooked > 0 ? totalSpend / appointmentsBooked : 100;
  const costPerShow = appointmentsShowed > 0 ? totalSpend / appointmentsShowed : 150;
  const costPerSale = sales > 0 ? totalSpend / sales : 300;
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  // Rate fields as percentages of total leads
  const optOutRate = totalLeads > 0 ? (optOuts / totalLeads) * 100 : 0;
  const badNumberRate = totalLeads > 0 ? (badNumbers / totalLeads) * 100 : 0;

  const result = computeScore({
    costPerBooked,
    costPerShow,
    costPerSale,
    ctr,
    frequency: avgFrequency,
    optOutRate,
    badNumberRate,
  });

  // Persist to campaign
  await FBLeadCampaign.updateOne(
    { _id: campaign._id },
    {
      $set: {
        performanceScore: result.score,
        performanceClass: result.performanceClass,
        lastScoredAt: new Date(),
        frequency: avgFrequency,
        optOutRate,
        badNumberRate,
      },
    }
  );

  return result;
}

/**
 * Score all active campaigns for a user.
 */
export async function scoreAllCampaignsForUser(userId: string): Promise<void> {
  await mongooseConnect();
  const campaigns = await FBLeadCampaign.find({
    userId,
    status: { $in: ["active", "paused"] },
  })
    .select("_id")
    .lean();

  for (const c of campaigns) {
    try {
      await scoreAdPerformance(String(c._id));
    } catch (err: any) {
      console.error(`[scoreAdPerformance] campaign ${c._id}:`, err?.message);
    }
  }
}
