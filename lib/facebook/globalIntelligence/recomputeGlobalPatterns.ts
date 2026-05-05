import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import AdMetricsDaily from "@/models/AdMetricsDaily";
import CRMOutcome from "@/models/CRMOutcome";
import FBGlobalAdPattern from "@/models/FBGlobalAdPattern";
import { extractPatternFromCampaign, ExtractedGlobalPattern } from "./extractPatternFromCampaign";
import { buildGenerationHints } from "./buildGenerationHints";
import { scorePatternConfidence } from "./scorePatternConfidence";

type RecomputeOptions = {
  minLeadForLearning?: number;
  staleAfterDays?: number;
  limit?: number;
};

export type GlobalRecomputeSummary = {
  campaignsScanned: number;
  patternsCreated: number;
  patternsUpdated: number;
  winnersPromoted: number;
  fatiguedPatterns: number;
  skipped: number;
};

type CampaignPerf = {
  spend: number;
  leads: number;
  appointments: number;
  sales: number;
  revenue: number;
  optOuts: number;
  badNumbers: number;
  frequency: number;
};

type Bucket = ExtractedGlobalPattern & {
  campaignIds: any[];
  totalCampaigns: number;
  totalSpend: number;
  totalLeads: number;
  totalAppointments: number;
  totalSales: number;
  totalRevenue: number;
  optOuts: number;
  badNumbers: number;
  weightedContactRate: number;
  weightedCloseRate: number;
  weightedAppointmentRate: number;
  weightedFrequency: number;
  weight: number;
  hasFatigue: boolean;
  lastSeenAt: Date;
  hintSources: any[];
};

function num(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function recencyWeight(dateValue: unknown): number {
  const date = dateValue ? new Date(String(dateValue)) : new Date(0);
  const ageDays = Math.max(0, (Date.now() - date.getTime()) / 86400000);
  return Math.max(0.25, Math.exp(-ageDays / 90));
}

async function loadPerfByCampaign(campaignIds: any[]): Promise<Map<string, CampaignPerf>> {
  const [metricAgg, outcomeAgg] = await Promise.all([
    AdMetricsDaily.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      {
        $group: {
          _id: "$campaignId",
          spend: { $sum: "$spend" },
          leads: { $sum: "$leads" },
          frequency: { $avg: "$frequency" },
          appointments: { $sum: "$appointmentsBooked" },
          sales: { $sum: "$sales" },
          revenue: { $sum: "$revenue" },
          optOuts: { $sum: "$optOuts" },
          badNumbers: { $sum: "$badNumbers" },
        },
      },
    ]),
    CRMOutcome.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      {
        $group: {
          _id: "$campaignId",
          appointments: { $sum: "$appointmentsBooked" },
          sales: { $sum: "$sales" },
          revenue: { $sum: "$revenue" },
          optOuts: { $sum: "$optOuts" },
          badNumbers: { $sum: "$badNumbers" },
        },
      },
    ]),
  ]);

  const map = new Map<string, CampaignPerf>();
  for (const row of metricAgg) {
    map.set(String(row._id), {
      spend: num(row.spend),
      leads: num(row.leads),
      appointments: num(row.appointments),
      sales: num(row.sales),
      revenue: num(row.revenue),
      optOuts: num(row.optOuts),
      badNumbers: num(row.badNumbers),
      frequency: num(row.frequency),
    });
  }
  for (const row of outcomeAgg) {
    const key = String(row._id);
    const current = map.get(key) || {
      spend: 0,
      leads: 0,
      appointments: 0,
      sales: 0,
      revenue: 0,
      optOuts: 0,
      badNumbers: 0,
      frequency: 0,
    };
    current.appointments = Math.max(current.appointments, num(row.appointments));
    current.sales = Math.max(current.sales, num(row.sales));
    current.revenue = Math.max(current.revenue, num(row.revenue));
    current.optOuts = Math.max(current.optOuts, num(row.optOuts));
    current.badNumbers = Math.max(current.badNumbers, num(row.badNumbers));
    map.set(key, current);
  }
  return map;
}

function campaignPerf(campaign: any, perf: CampaignPerf): CampaignPerf {
  const leads = perf.leads || num(campaign.totalLeads);
  const spend = perf.spend || num(campaign.totalSpend);
  return {
    spend,
    leads,
    appointments: perf.appointments || num(campaign.appointments),
    sales: perf.sales || num(campaign.sales),
    revenue: num(perf.revenue),
    optOuts: num(perf.optOuts) || (leads * num(campaign.optOutRate)) / 100,
    badNumbers: num(perf.badNumbers) || (leads * num(campaign.badNumberRate)) / 100,
    frequency: num(perf.frequency) || num(campaign.frequency),
  };
}

export async function recomputeGlobalPatterns(
  options: RecomputeOptions = {}
): Promise<GlobalRecomputeSummary> {
  await mongooseConnect();

  const summary: GlobalRecomputeSummary = {
    campaignsScanned: 0,
    patternsCreated: 0,
    patternsUpdated: 0,
    winnersPromoted: 0,
    fatiguedPatterns: 0,
    skipped: 0,
  };

  const campaigns = await FBLeadCampaign.find({
    leadType: { $exists: true, $ne: "" },
    status: { $in: ["active", "paused", "setup"] },
  })
    .sort({ updatedAt: -1 })
    .limit(options.limit || 5000)
    .select(
      "_id leadType notes totalSpend totalLeads cpl appointments sales costPerAppointment costPerSale contactRate closeRate appointmentRate frequency optOutRate badNumberRate creativeFatigue performanceScore status updatedAt"
    )
    .lean();

  summary.campaignsScanned = campaigns.length;
  const perfMap = await loadPerfByCampaign(campaigns.map((c: any) => c._id));
  const buckets = new Map<string, Bucket>();

  for (const campaign of campaigns as any[]) {
    const extracted = extractPatternFromCampaign(campaign);
    if (!extracted) {
      summary.skipped += 1;
      continue;
    }

    const perf = campaignPerf(campaign, perfMap.get(String(campaign._id)) || ({} as CampaignPerf));
    if (perf.leads < (options.minLeadForLearning ?? 1) && perf.spend < 5) {
      summary.skipped += 1;
      continue;
    }

    const key = `${extracted.leadType}:${extracted.patternFingerprint}`;
    const weight = Math.min(6, Math.max(0.2, Math.log1p(perf.leads) + Math.log1p(perf.spend) / 3)) *
      recencyWeight(campaign.updatedAt);
    const existing = buckets.get(key);
    const bucket =
      existing ||
      ({
        ...extracted,
        campaignIds: [],
        totalCampaigns: 0,
        totalSpend: 0,
        totalLeads: 0,
        totalAppointments: 0,
        totalSales: 0,
        totalRevenue: 0,
        optOuts: 0,
        badNumbers: 0,
        weightedContactRate: 0,
        weightedCloseRate: 0,
        weightedAppointmentRate: 0,
        weightedFrequency: 0,
        weight: 0,
        hasFatigue: false,
        lastSeenAt: new Date(0),
        hintSources: [],
      } as Bucket);

    bucket.campaignIds.push(campaign._id);
    bucket.totalCampaigns += 1;
    bucket.totalSpend += perf.spend;
    bucket.totalLeads += perf.leads;
    bucket.totalAppointments += perf.appointments;
    bucket.totalSales += perf.sales;
    bucket.totalRevenue += perf.revenue;
    bucket.optOuts += perf.optOuts;
    bucket.badNumbers += perf.badNumbers;
    bucket.weightedContactRate += num(campaign.contactRate) * weight;
    bucket.weightedCloseRate += (num(campaign.closeRate) || (perf.appointments > 0 ? perf.sales / perf.appointments : 0)) * weight;
    bucket.weightedAppointmentRate +=
      (num(campaign.appointmentRate) || (perf.leads > 0 ? perf.appointments / perf.leads : 0)) * weight;
    bucket.weightedFrequency += perf.frequency * weight;
    bucket.weight += weight;
    bucket.hasFatigue = bucket.hasFatigue || !!campaign.creativeFatigue || perf.frequency >= 4.5;
    const updatedAt = campaign.updatedAt ? new Date(campaign.updatedAt) : new Date();
    if (updatedAt > bucket.lastSeenAt) bucket.lastSeenAt = updatedAt;
    bucket.hintSources.push({
      ...extracted,
      performanceScore: num(campaign.performanceScore),
      status: campaign.status,
    });
    buckets.set(key, bucket);
  }

  const seenKeys: string[] = [];
  for (const bucket of buckets.values()) {
    const avgCpl = bucket.totalLeads > 0 ? bucket.totalSpend / bucket.totalLeads : 0;
    const avgCostPerAppointment =
      bucket.totalAppointments > 0 ? bucket.totalSpend / bucket.totalAppointments : 0;
    const avgCostPerSale = bucket.totalSales > 0 ? bucket.totalSpend / bucket.totalSales : 0;
    const avgContactRate = bucket.weight > 0 ? bucket.weightedContactRate / bucket.weight : 0;
    const avgCloseRate = bucket.weight > 0 ? bucket.weightedCloseRate / bucket.weight : 0;
    const avgAppointmentRate = bucket.weight > 0 ? bucket.weightedAppointmentRate / bucket.weight : 0;
    const avgFrequency = bucket.weight > 0 ? bucket.weightedFrequency / bucket.weight : 0;
    const avgOptOutRate = bucket.totalLeads > 0 ? (bucket.optOuts / bucket.totalLeads) * 100 : 0;
    const avgBadNumberRate = bucket.totalLeads > 0 ? (bucket.badNumbers / bucket.totalLeads) * 100 : 0;
    const scored = scorePatternConfidence({
      totalCampaigns: bucket.totalCampaigns,
      totalSpend: bucket.totalSpend,
      totalLeads: bucket.totalLeads,
      totalAppointments: bucket.totalAppointments,
      totalSales: bucket.totalSales,
      avgCpl,
      avgCostPerAppointment,
      avgCostPerSale,
      avgContactRate,
      avgCloseRate,
      avgAppointmentRate,
      avgOptOutRate,
      avgBadNumberRate,
      avgFrequency,
      lastSeenAt: bucket.lastSeenAt,
      hasFatigue: bucket.hasFatigue,
    });

    seenKeys.push(bucket.patternFingerprint);
    if (scored.status === "winner") summary.winnersPromoted += 1;
    if (scored.status === "fatigued") summary.fatiguedPatterns += 1;

    const update = {
      leadType: bucket.leadType,
      sourceType: bucket.sourceType,
      winningFamilyId: bucket.winningFamilyId,
      variationType: bucket.variationType,
      vendorStyleTag: bucket.vendorStyleTag,
      creativeArchetype: bucket.creativeArchetype,
      pageType: bucket.pageType,
      hookType: bucket.hookType,
      bodyAngle: bucket.bodyAngle,
      ctaStyle: bucket.ctaStyle,
      buttonStyle: bucket.buttonStyle,
      colorDirection: bucket.colorDirection,
      headlineTemplate: bucket.headlineTemplate,
      primaryTextTemplate: bucket.primaryTextTemplate,
      imagePromptStyle: bucket.imagePromptStyle,
      offerType: bucket.offerType,
      emotionalAngle: bucket.emotionalAngle,
      audienceAngle: bucket.audienceAngle,
      qualifierAngle: bucket.qualifierAngle,
      trustAngle: bucket.trustAngle,
      benefitFocus: bucket.benefitFocus,
      urgencyAngle: bucket.urgencyAngle,
      complianceFlags: bucket.complianceFlags,
      totalCampaigns: bucket.totalCampaigns,
      totalSpend: Number(bucket.totalSpend.toFixed(2)),
      totalLeads: bucket.totalLeads,
      totalAppointments: bucket.totalAppointments,
      totalSales: bucket.totalSales,
      totalRevenue: Number(bucket.totalRevenue.toFixed(2)),
      avgCpl: Number(avgCpl.toFixed(2)),
      avgCostPerAppointment: Number(avgCostPerAppointment.toFixed(2)),
      avgCostPerSale: Number(avgCostPerSale.toFixed(2)),
      avgContactRate: Number(avgContactRate.toFixed(4)),
      avgCloseRate: Number(avgCloseRate.toFixed(4)),
      avgAppointmentRate: Number(avgAppointmentRate.toFixed(4)),
      avgOptOutRate: Number(avgOptOutRate.toFixed(2)),
      avgBadNumberRate: Number(avgBadNumberRate.toFixed(2)),
      avgFrequency: Number(avgFrequency.toFixed(2)),
      performanceScore: scored.performanceScore,
      confidenceScore: scored.confidenceScore,
      sampleSizeScore: scored.sampleSizeScore,
      status: scored.status,
      generationHints: buildGenerationHints(bucket.hintSources),
      sampledCampaignIds: bucket.campaignIds.slice(0, 50),
      lastSeenAt: bucket.lastSeenAt,
      ...(scored.status === "winner" ? { lastPromotedAt: new Date() } : {}),
    };

    const before = await FBGlobalAdPattern.findOne({
      patternFingerprint: bucket.patternFingerprint,
      leadType: bucket.leadType,
    })
      .select("_id")
      .lean();

    await FBGlobalAdPattern.updateOne(
      { patternFingerprint: bucket.patternFingerprint, leadType: bucket.leadType },
      { $set: update, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    if (before) summary.patternsUpdated += 1;
    else summary.patternsCreated += 1;
  }

  const staleCutoff = new Date(Date.now() - (options.staleAfterDays || 120) * 86400000);
  await FBGlobalAdPattern.updateMany(
    {
      patternFingerprint: { $nin: seenKeys },
      lastSeenAt: { $lt: staleCutoff },
      status: { $nin: ["archived"] },
    },
    { $set: { status: "archived" } }
  );

  return summary;
}
