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
    cplScore: number;
    leadQualityComponent: number;
    appointmentScore: number;
    closeRateScore: number;
  };
}

function classifyScore(score: number): PerformanceClass {
  if (score >= 90) return "SCALE";
  if (score >= 70) return "DUPLICATE_TEST";
  if (score >= 50) return "MONITOR";
  if (score >= 30) return "FIX";
  return "PAUSE";
}

function computeScore(params: {
  targetCpl: number;
  actualCpl: number;
  leadQualityScore: number;
  appointmentTarget: number;
  costPerAppointment: number;
  closeRate: number;
}): ScoreResult {
  const cplScore =
    params.targetCpl > 0 && params.actualCpl > 0
      ? (params.targetCpl / params.actualCpl) * 100
      : 0;
  const appointmentScore =
    params.appointmentTarget > 0 && params.costPerAppointment > 0
      ? (params.appointmentTarget / params.costPerAppointment) * 100
      : 0;
  const leadQualityComponent = Math.max(params.leadQualityScore * 20, 0);
  const closeRateScore = Math.max(params.closeRate * 100, 0);

  const raw =
    cplScore * 0.3 +
    leadQualityComponent * 0.2 +
    appointmentScore * 0.3 +
    closeRateScore * 0.2;
  const capped = Math.max(0, Math.min(150, raw));
  const score = Number(capped.toFixed(2));

  return {
    score,
    performanceClass: classifyScore(score),
    breakdown: {
      cplScore,
      leadQualityComponent,
      appointmentScore,
      closeRateScore,
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
        avgFrequency: { $avg: "$frequency" },
      },
    },
  ]);

  const outcomes = outcomeAgg[0] || {};
  const metrics = metricsAgg[0] || {};

  const totalSpend = metrics.totalSpend || (campaign as any).totalSpend || 0;
  const totalLeadsRaw =
    metrics.totalLeads ||
    Number((campaign as any).totalLeads ?? 0) ||
    0;
  const avgFrequency = metrics.avgFrequency || (campaign as any).frequency || 0;

  const outcomeStats =
    (campaign as any).leadOutcomeStats ||
    (campaign as any).outcomeStats ||
    {};

  const answeredFromStats =
    Number(outcomeStats.answered ?? outcomeStats.answer ?? outcomeStats.contacts ?? 0) || 0;
  const notInterestedFromStats =
    Number(outcomeStats.notInterested ?? outcomeStats.disqualified ?? 0) || 0;
  const noResponseFromStats =
    Number(outcomeStats.noResponse ?? outcomeStats.unreached ?? 0) || 0;
  const bookedFromStats =
    Number(
      outcomeStats.bookedAppointments ??
        outcomeStats.booked ??
        outcomeStats.appointments ??
        outcomeStats.scheduled ??
        0
    ) || 0;
  const salesFromStats = Number(outcomeStats.sales ?? outcomeStats.closed ?? outcomeStats.wins ?? 0) || 0;

  const appointmentsBooked = outcomes.appointmentsBooked || 0;
  const salesAgg = outcomes.sales || 0;
  const optOuts = outcomes.optOuts || 0;
  const badNumbers = outcomes.badNumbers || 0;

  const appointments = appointmentsBooked || bookedFromStats;
  const sales = salesAgg || salesFromStats;
  const totalLeads =
    totalLeadsRaw ||
    appointments + answeredFromStats + notInterestedFromStats + noResponseFromStats;

  const costPerAppointmentRaw = appointments > 0 ? totalSpend / appointments : 0;
  const costPerSaleRaw = sales > 0 ? totalSpend / sales : 0;
  const costPerAppointment = appointments > 0 ? Number(costPerAppointmentRaw.toFixed(2)) : 0;
  const costPerSale = sales > 0 ? Number(costPerSaleRaw.toFixed(2)) : 0;
  const appointmentRateRaw = totalLeads > 0 ? appointments / totalLeads : 0;
  const appointmentRate = Number(appointmentRateRaw.toFixed(4));
  const closeRateRaw = appointments > 0 ? sales / appointments : 0;
  const closeRate = Number(closeRateRaw.toFixed(4));
  const contactRateRaw = totalLeads > 0 ? answeredFromStats / totalLeads : 0;
  const contactRate = Number(contactRateRaw.toFixed(4));

  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const targetCpl = Number((campaign as any).targetCpl || 0);
  const appointmentTarget = Number(
    (campaign as any).targetCostPerBooked ??
      (campaign as any).targetCostPerAppointment ??
      0
  );

  const leadQualityScore =
    totalLeads > 0
      ? Number(
          (
            (appointments * 5 +
              answeredFromStats * 2 -
              notInterestedFromStats * 2 -
              noResponseFromStats) /
            totalLeads
          ).toFixed(2)
        )
      : 0;

  const result = computeScore({
    targetCpl,
    actualCpl: cpl,
    leadQualityScore,
    appointmentTarget,
    costPerAppointment: costPerAppointmentRaw,
    closeRate: closeRateRaw,
  });

  const optOutRate = totalLeads > 0 ? (optOuts / totalLeads) * 100 : 0;
  const badNumberRate = totalLeads > 0 ? (badNumbers / totalLeads) * 100 : 0;

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
        appointments,
        sales,
        costPerAppointment,
        costPerSale,
        appointmentRate,
        closeRate,
        contactRate,
        leadQualityScore,
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
