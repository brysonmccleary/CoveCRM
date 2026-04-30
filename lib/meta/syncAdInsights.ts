// lib/meta/syncAdInsights.ts
// Sync Meta Ad Insights (spend, impressions, clicks, CPM, CTR, CPC) into AdMetricsDaily

import mongooseConnect from "@/lib/mongooseConnect";
import AdMetricsDaily from "@/models/AdMetricsDaily";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import Lead from "@/lib/mongo/leads";
import { Types } from "mongoose";
import { evaluateFacebookOptimizationAlerts } from "@/lib/facebook/optimizationAlerts";

const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";

interface InsightRecord {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  date_start?: string;
  date_stop?: string;
}

export interface SyncResult {
  syncedDays: number;
  totalSpend: number;
  totalLeads: number;
  error?: string;
}

export async function syncAdInsights(
  userId: string | Types.ObjectId,
  userEmail: string,
  adAccountId: string,
  accessToken: string,
  days: number = 7
): Promise<SyncResult> {
  await mongooseConnect();

  if (!adAccountId || !accessToken) {
    return { syncedDays: 0, totalSpend: 0, totalLeads: 0, error: "Missing adAccountId or accessToken" };
  }

  // Normalize ad account ID
  const actId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

  const url = new URL(`${META_GRAPH_BASE}/${actId}/insights`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set(
    "fields",
    "campaign_id,campaign_name,adset_id,ad_id,ad_name,spend,impressions,clicks,cpc,cpm,ctr,date_start,date_stop"
  );
  url.searchParams.set("date_preset", days <= 7 ? "last_7d" : days <= 14 ? "last_14d" : days <= 30 ? "last_30d" : "last_90d");
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { syncedDays: 0, totalSpend: 0, totalLeads: 0, error: `Meta API error ${resp.status}: ${body.slice(0, 200)}` };
  }

  const json = await resp.json() as any;
  const insights: InsightRecord[] = json?.data || [];

  // Get all campaigns for this user
  const userCampaigns = await FBLeadCampaign.find({
    userEmail,
  }).lean() as any[];

  const campaignByMetaId = new Map<string, any>();
  const campaignByAdId = new Map<string, any>();
  for (const c of userCampaigns) {
    if (c.metaCampaignId) campaignByMetaId.set(c.metaCampaignId, c);
    if (c.metaAdsetId) campaignByAdId.set(c.metaAdsetId, c);
  }

  let syncedDays = 0;
  let totalSpend = 0;
  let totalLeads = 0;

  // Per-campaign aggregates: campaignId → { spend, leads, impressions, clicks, cpm, cpc, ctr }
  const campaignTotals = new Map<string, {
    spend: number; leads: number;
    impressions: number; clicks: number;
    weightedCpm: number; weightedCpc: number; weightedCtr: number;
    spendForRatios: number;
  }>();
  const campaignAdTotals = new Map<string, Map<string, {
    spend: number;
    leads: number;
    clicks: number;
    cpl: number;
  }>>();

  for (const insight of insights) {
    const campaign =
      (insight.campaign_id ? campaignByMetaId.get(insight.campaign_id) : null) ||
      (insight.adset_id ? campaignByAdId.get(insight.adset_id) : null) ||
      (userCampaigns.length === 1 ? userCampaigns[0] : null);

    if (!campaign) continue;

    const date = insight.date_start || "";
    if (!date) continue;

    const spend = parseFloat(insight.spend || "0");
    const impressions = parseInt(insight.impressions || "0", 10);
    const clicks = parseInt(insight.clicks || "0", 10);
    const cpc = parseFloat(insight.cpc || "0");
    const cpm = parseFloat(insight.cpm || "0");
    const ctr = parseFloat(insight.ctr || "0");

    // Count leads from CRM for this campaign on this date
    const startOfDay = new Date(date + "T00:00:00Z");
    const endOfDay = new Date(date + "T23:59:59Z");
    const leads = await Lead.countDocuments({
      userEmail,
      ...(insight.ad_id ? { metaAdId: insight.ad_id } : { metaCampaignId: insight.campaign_id }),
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });

    const cpl = leads > 0 && spend > 0 ? spend / leads : 0;

    await AdMetricsDaily.findOneAndUpdate(
      { campaignId: (campaign as any)._id, date },
      {
        $set: {
          userId: new Types.ObjectId(String(userId)),
          userEmail,
          spend,
          impressions,
          clicks,
          ctr,
          cpl,
          leads,
        },
      },
      { upsert: true }
    );

    syncedDays++;
    totalSpend += spend;
    totalLeads += leads;

    // Accumulate per-campaign totals so we can update FBLeadCampaign after the loop
    const cid = String((campaign as any)._id);
    const prev = campaignTotals.get(cid) || {
      spend: 0, leads: 0, impressions: 0, clicks: 0,
      weightedCpm: 0, weightedCpc: 0, weightedCtr: 0, spendForRatios: 0,
    };
    campaignTotals.set(cid, {
      spend: prev.spend + spend,
      leads: prev.leads + leads,
      impressions: prev.impressions + impressions,
      clicks: prev.clicks + clicks,
      // Spend-weighted averages for per-mille/per-click metrics
      weightedCpm: prev.weightedCpm + cpm * spend,
      weightedCpc: prev.weightedCpc + cpc * clicks,
      weightedCtr: prev.weightedCtr + ctr * impressions,
      spendForRatios: prev.spendForRatios + spend,
    });

    const adId = String(insight.ad_id || "").trim();
    if (adId) {
      const existingCampaignAds = campaignAdTotals.get(cid) || new Map<string, {
        spend: number;
        leads: number;
        clicks: number;
        cpl: number;
      }>();
      const prevAd = existingCampaignAds.get(adId) || { spend: 0, leads: 0, clicks: 0, cpl: 0 };
      const nextSpend = prevAd.spend + spend;
      const nextLeads = prevAd.leads + leads;
      const nextClicks = prevAd.clicks + clicks;
      existingCampaignAds.set(adId, {
        spend: nextSpend,
        leads: nextLeads,
        clicks: nextClicks,
        cpl: nextLeads > 0 && nextSpend > 0 ? nextSpend / nextLeads : 0,
      });
      campaignAdTotals.set(cid, existingCampaignAds);
    }
  }

  // ✅ Update FBLeadCampaign aggregate metrics so campaign cards show real synced data
  const syncedAt = new Date();
  for (const [cid, totals] of campaignTotals.entries()) {
    try {
      const aggCpl = totals.leads > 0 && totals.spend > 0 ? totals.spend / totals.leads : 0;
      const aggCpm = totals.spendForRatios > 0 ? totals.weightedCpm / totals.spendForRatios : 0;
      const aggCpc = totals.clicks > 0 ? totals.weightedCpc / totals.clicks : 0;
      const aggCtr = totals.impressions > 0 ? totals.weightedCtr / totals.impressions : 0;
      const campaignDoc = userCampaigns.find((campaign) => String((campaign as any)._id) === cid);
      const currentAds = Array.isArray((campaignDoc as any)?.ads) ? [ ...(campaignDoc as any).ads ] : [];
      const perAdTotals = campaignAdTotals.get(cid) || new Map();
      const nextAds = currentAds.map((ad: any) => {
        const adMetaId = String(ad?.metaAdId || "").trim();
        const adTotals = adMetaId ? perAdTotals.get(adMetaId) : null;
        if (!adTotals) return ad;
        return {
          ...ad,
          spend: Math.round(adTotals.spend * 100) / 100,
          leads: adTotals.leads,
          clicks: adTotals.clicks,
          cpl: Math.round(adTotals.cpl * 100) / 100,
        };
      });
      await FBLeadCampaign.findByIdAndUpdate(cid, {
        $set: {
          totalSpend: Math.round(totals.spend * 100) / 100,
          totalLeads: totals.leads,
          totalClicks: totals.clicks,
          totalImpressions: totals.impressions,
          cpl: Math.round(aggCpl * 100) / 100,
          cpm: Math.round(aggCpm * 100) / 100,
          cpc: Math.round(aggCpc * 100) / 100,
          ctr: Math.round(aggCtr * 10000) / 10000,
          metaLastSyncedAt: syncedAt,
          metaSyncStatus: "synced",
          metaSyncError: "",
          ads: nextAds,
        },
      });
      await evaluateFacebookOptimizationAlerts(cid).catch(() => {});
    } catch {
      // non-blocking — daily metrics already written
    }
  }

  // ✅ Fetch live Meta object health for every campaign that has a metaCampaignId
  for (const campaign of userCampaigns) {
    const metaCampaignId = String(campaign.metaCampaignId || "").trim();
    if (!metaCampaignId) continue;

    try {
      const healthUrl = new URL(`${META_GRAPH_BASE}/${metaCampaignId}`);
      healthUrl.searchParams.set("fields", "effective_status,status,daily_budget");
      healthUrl.searchParams.set("access_token", accessToken);

      const healthResp = await fetch(healthUrl.toString());
      if (!healthResp.ok) continue;

      const h = await healthResp.json() as any;
      const effectiveStatus = String(h?.effective_status || "").toUpperCase();
      const configuredStatus = String(h?.status || "").toUpperCase();
      // Meta returns daily_budget in cents as a string
      const dailyBudgetLive = h?.daily_budget
        ? Math.round(parseFloat(String(h.daily_budget)) / 100 * 100) / 100
        : 0;

      let objectHealth: string;
      if (effectiveStatus === "ACTIVE") {
        objectHealth = "healthy";
      } else if (
        effectiveStatus === "PAUSED" ||
        effectiveStatus === "CAMPAIGN_PAUSED" ||
        effectiveStatus === "ADSET_PAUSED"
      ) {
        objectHealth = "paused_on_meta";
      } else if (effectiveStatus === "ARCHIVED" || effectiveStatus === "DELETED") {
        objectHealth = "disconnected";
      } else {
        // Unknown status — mark as stale if we have a recent sync, else sync_failed
        const lastSync = campaign.metaLastSyncedAt ? new Date(campaign.metaLastSyncedAt) : null;
        objectHealth = lastSync ? "stale" : "sync_failed";
      }

      await FBLeadCampaign.findByIdAndUpdate(String(campaign._id), {
        $set: {
          metaEffectiveStatus: effectiveStatus,
          metaConfiguredStatus: configuredStatus,
          ...(dailyBudgetLive > 0 ? { metaDailyBudgetLive: dailyBudgetLive } : {}),
          metaObjectHealth: objectHealth,
          metaLastSyncedAt: syncedAt,
        },
      });
    } catch {
      // non-blocking health check — don't fail the whole sync
    }
  }

  // Update user's last sync timestamp
  try {
    const User = (await import("@/models/User")).default;
    await User.updateOne(
      { email: userEmail },
      { $set: { metaLastInsightSyncAt: new Date() } }
    );
  } catch {}

  return { syncedDays, totalSpend, totalLeads };
}
