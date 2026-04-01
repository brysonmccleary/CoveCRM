// lib/meta/syncAdInsights.ts
// Sync Meta Ad Insights (spend, impressions, clicks, CPM, CTR, CPC) into AdMetricsDaily

import mongooseConnect from "@/lib/mongooseConnect";
import AdMetricsDaily from "@/models/AdMetricsDaily";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import Lead from "@/lib/mongo/leads";
import { Types } from "mongoose";

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

  // Per-campaign aggregates: campaignId → { spend, leads }
  const campaignTotals = new Map<string, { spend: number; leads: number }>();

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
      metaCampaignId: insight.campaign_id,
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
    const prev = campaignTotals.get(cid) || { spend: 0, leads: 0 };
    campaignTotals.set(cid, { spend: prev.spend + spend, leads: prev.leads + leads });
  }

  // ✅ Update FBLeadCampaign.totalSpend, totalLeads, and cpl so campaign cards show real data
  for (const [cid, totals] of campaignTotals.entries()) {
    try {
      const aggCpl = totals.leads > 0 && totals.spend > 0 ? totals.spend / totals.leads : 0;
      await FBLeadCampaign.findByIdAndUpdate(cid, {
        $set: {
          totalSpend: Math.round(totals.spend * 100) / 100,
          totalLeads: totals.leads,
          cpl: Math.round(aggCpl * 100) / 100,
        },
      });
    } catch {
      // non-blocking — daily metrics already written
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
