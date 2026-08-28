// lib/meta/syncAdInsights.ts
// Sync Meta Ad Insights (spend, impressions, clicks, CPM, CTR, CPC) into AdMetricsDaily

import mongooseConnect from "@/lib/mongooseConnect";
import AdMetricsDaily from "@/models/AdMetricsDaily";
import MetaAdMetricsDaily from "@/models/MetaAdMetricsDaily";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import Lead from "@/lib/mongo/leads";
import { Types } from "mongoose";
import { evaluateFacebookOptimizationAlerts } from "@/lib/facebook/optimizationAlerts";
import { metaGraphUrl } from "@/lib/meta/graphApi";

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
  reach?: string;
  frequency?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
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

  const url = new URL(metaGraphUrl(`${actId}/insights`));
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set(
    "fields",
    "campaign_id,campaign_name,adset_id,ad_id,ad_name,spend,impressions,reach,frequency,clicks,cpc,cpm,ctr,actions,date_start,date_stop"
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
  const campaignDailyTotals = new Map<string, {
    campaignId: any;
    date: string;
    spend: number;
    leads: number;
    impressions: number;
    clicks: number;
    weightedCtr: number;
  }>();

  // Pre-aggregate lead counts by (metaAdId, date) and (metaCampaignId, date)
  // so we avoid one DB query per insight record (N+1 elimination).
  const leadsByAdAndDate = new Map<string, number>();
  const leadsByCampaignAndDate = new Map<string, number>();
  try {
    const dateRange = insights.reduce(
      (acc, ins) => {
        const d = ins.date_start;
        if (!d) return acc;
        if (!acc.min || d < acc.min) acc.min = d;
        if (!acc.max || d > acc.max) acc.max = d;
        return acc;
      },
      { min: "", max: "" }
    );

    if (dateRange.min && dateRange.max) {
      const startOfRange = new Date(dateRange.min + "T00:00:00Z");
      const endOfRange = new Date(dateRange.max + "T23:59:59Z");

      const adAgg = await Lead.aggregate([
        {
          $match: {
            userEmail,
            metaAdId: { $exists: true, $ne: "" },
            createdAt: { $gte: startOfRange, $lte: endOfRange },
          },
        },
        {
          $group: {
            _id: {
              metaAdId: "$metaAdId",
              date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
            },
            count: { $sum: 1 },
          },
        },
      ]);
      for (const row of adAgg) {
        leadsByAdAndDate.set(`${row._id.metaAdId}:${row._id.date}`, row.count);
      }

      const campaignAgg = await Lead.aggregate([
        {
          $match: {
            userEmail,
            metaCampaignId: { $exists: true, $ne: "" },
            createdAt: { $gte: startOfRange, $lte: endOfRange },
          },
        },
        {
          $group: {
            _id: {
              metaCampaignId: "$metaCampaignId",
              date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
            },
            count: { $sum: 1 },
          },
        },
      ]);
      for (const row of campaignAgg) {
        leadsByCampaignAndDate.set(`${row._id.metaCampaignId}:${row._id.date}`, row.count);
      }
    }
  } catch (aggErr: any) {
    console.warn("[syncAdInsights] lead aggregation failed, defaulting to 0:", aggErr?.message);
  }

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
    const reach = insight.reach == null ? null : parseInt(insight.reach, 10);
    const frequency = insight.frequency == null ? null : parseFloat(insight.frequency);
    const actionValue = (name: string): number | null => {
      const action = (insight.actions || []).find((candidate) => candidate.action_type === name);
      return action?.value == null ? null : Number(action.value);
    };
    const linkClicks = actionValue("link_click");
    const landingPageViews = actionValue("landing_page_view");

    // Use ad-level count when insight.ad_id is present (level=ad always has ad_id).
    // No campaign-level fallback — it would double-count multi-ad campaigns.
    const leads =
      insight.ad_id
        ? (leadsByAdAndDate.get(`${insight.ad_id}:${date}`) ?? 0)
        : (leadsByCampaignAndDate.get(`${insight.campaign_id}:${date}`) ?? 0);

    const dailyKey = `${String((campaign as any)._id)}:${date}`;
    const prevDaily = campaignDailyTotals.get(dailyKey) || {
      campaignId: (campaign as any)._id,
      date,
      spend: 0,
      leads: 0,
      impressions: 0,
      clicks: 0,
      weightedCtr: 0,
    };
    campaignDailyTotals.set(dailyKey, {
      ...prevDaily,
      spend: prevDaily.spend + spend,
      leads: prevDaily.leads + leads,
      impressions: prevDaily.impressions + impressions,
      clicks: prevDaily.clicks + clicks,
      weightedCtr: prevDaily.weightedCtr + ctr * impressions,
    });

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
      const adMetadata = (Array.isArray((campaign as any).ads) ? (campaign as any).ads : [])
        .find((ad: any) => String(ad?.metaAdId || "") === adId) || {};
      const resolvedLeads = leads;
      await MetaAdMetricsDaily.findOneAndUpdate(
        { userEmail, metaAdId: adId, date },
        {
          $set: {
            campaignId: (campaign as any)._id,
            userId: new Types.ObjectId(String(userId)),
            userEmail,
            date,
            metaCampaignId: String(insight.campaign_id || (campaign as any).metaCampaignId || ""),
            metaAdsetId: String(insight.adset_id || (campaign as any).metaAdsetId || ""),
            metaAdId: adId,
            metaCreativeId: String(adMetadata.metaCreativeId || ""),
            creativeFamily: String(adMetadata.creativeFamily || ""),
            layoutId: String(adMetadata.layoutId || ""),
            variantId: String(adMetadata.variantId || ""),
            hookClass: String(adMetadata.hookClass || ""),
            imageIdentity: String(adMetadata.imageIdentity || adMetadata.imageUrl || ""),
            backgroundIdentity: String(adMetadata.backgroundIdentity || ""),
            spend,
            impressions,
            reach: Number.isFinite(reach as number) ? reach : null,
            frequency: Number.isFinite(frequency as number) ? frequency : null,
            clicks,
            linkClicks: Number.isFinite(linkClicks as number) ? linkClicks : null,
            ctr: Number.isFinite(ctr) ? ctr : null,
            cpc: Number.isFinite(cpc) ? cpc : null,
            cpm: Number.isFinite(cpm) ? cpm : null,
            landingPageViews: Number.isFinite(landingPageViews as number) ? landingPageViews : null,
            landingPageViewRate: landingPageViews != null && linkClicks != null && linkClicks > 0
              ? landingPageViews / linkClicks : null,
            leads: resolvedLeads,
            cpl: resolvedLeads > 0 && spend > 0 ? spend / resolvedLeads : null,
          },
        },
        { upsert: true, new: true }
      );
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

  for (const daily of campaignDailyTotals.values()) {
    const cpl = daily.leads > 0 && daily.spend > 0 ? daily.spend / daily.leads : 0;
    const ctr = daily.impressions > 0 ? daily.weightedCtr / daily.impressions : 0;
    await AdMetricsDaily.findOneAndUpdate(
      { campaignId: daily.campaignId, date: daily.date },
      {
        $set: {
          userId: new Types.ObjectId(String(userId)),
          userEmail,
          spend: daily.spend,
          impressions: daily.impressions,
          clicks: daily.clicks,
          ctr,
          cpl,
          leads: daily.leads,
        },
      },
      { upsert: true }
    );
    syncedDays++;
  }

  // ✅ Update FBLeadCampaign aggregate metrics so campaign cards show real synced data.
  //
  // IMPORTANT: totalSpend/totalLeads/totalClicks/totalImpressions/cpl/cpm/cpc/ctr are LIFETIME
  // numbers. They must NEVER be derived from `totals` (the current sync's window-only sum) —
  // doing so silently truncates a campaign's history down to whatever window this particular
  // sync call requested (7/14/30/90 days), every time it runs. Lifetime numbers are recomputed
  // here by aggregating every AdMetricsDaily row ever written for the campaign, since each day's
  // row is durably upserted (never deleted) across all past syncs.
  const syncedAt = new Date();
  for (const [cid, totals] of campaignTotals.entries()) {
    try {
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

      // Lifetime aggregate — every AdMetricsDaily row for this campaign, not just this sync's window.
      const lifetimeAgg = await AdMetricsDaily.aggregate([
        { $match: { campaignId: new Types.ObjectId(cid) } },
        {
          $group: {
            _id: null,
            spend: { $sum: "$spend" },
            leads: { $sum: "$leads" },
            clicks: { $sum: "$clicks" },
            impressions: { $sum: "$impressions" },
          },
        },
      ]);
      const lifetime = lifetimeAgg[0] || { spend: 0, leads: 0, clicks: 0, impressions: 0 };
      const lifetimeSpend = Math.round((Number(lifetime.spend) || 0) * 100) / 100;
      const lifetimeLeads = Number(lifetime.leads) || 0;
      const lifetimeClicks = Number(lifetime.clicks) || 0;
      const lifetimeImpressions = Number(lifetime.impressions) || 0;

      const storedSpend = Number((campaignDoc as any)?.totalSpend || 0);
      const storedLeads = Number((campaignDoc as any)?.totalLeads || 0);

      // Guard: a fresh lifetime aggregate should never come in lower than what's already stored.
      // If it does, AdMetricsDaily rows are missing (e.g. a gap in sync history) — warn and keep
      // the stored value rather than silently shrinking the campaign's real totals.
      let finalSpend = lifetimeSpend;
      if (lifetimeSpend < storedSpend) {
        console.warn(
          `[syncAdInsights] Lifetime totalSpend aggregate ($${lifetimeSpend}) is LOWER than stored value ($${storedSpend}) for campaign ${cid}. AdMetricsDaily rows may be missing — keeping stored value instead of shrinking it.`
        );
        finalSpend = storedSpend;
      }
      let finalLeads = lifetimeLeads;
      if (lifetimeLeads < storedLeads) {
        console.warn(
          `[syncAdInsights] Lifetime totalLeads aggregate (${lifetimeLeads}) is LOWER than stored value (${storedLeads}) for campaign ${cid}. AdMetricsDaily rows may be missing — keeping stored value instead of shrinking it.`
        );
        finalLeads = storedLeads;
      }

      const lifetimeCpl = finalLeads > 0 && finalSpend > 0 ? finalSpend / finalLeads : 0;
      const lifetimeCpm = lifetimeImpressions > 0 && finalSpend > 0 ? (finalSpend / lifetimeImpressions) * 1000 : 0;
      const lifetimeCpc = lifetimeClicks > 0 && finalSpend > 0 ? finalSpend / lifetimeClicks : 0;
      const lifetimeCtr = lifetimeImpressions > 0 ? lifetimeClicks / lifetimeImpressions : 0;

      await FBLeadCampaign.findByIdAndUpdate(cid, {
        $set: {
          totalSpend: finalSpend,
          totalLeads: finalLeads,
          totalClicks: lifetimeClicks,
          totalImpressions: lifetimeImpressions,
          cpl: Math.round(lifetimeCpl * 100) / 100,
          cpm: Math.round(lifetimeCpm * 100) / 100,
          cpc: Math.round(lifetimeCpc * 100) / 100,
          ctr: Math.round(lifetimeCtr * 10000) / 10000,
          // Window snapshot — this sync call's requested window only (e.g. last 7/30 days).
          // Kept separate from the lifetime fields above; never conflate the two.
          windowSpend7d: Math.round(totals.spend * 100) / 100,
          windowLeads7d: totals.leads,
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
      const healthUrl = new URL(metaGraphUrl(metaCampaignId));
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
