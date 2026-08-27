import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";
import { metaGraphUrl } from "@/lib/meta/graphApi";
import { hasMetaStatusDrift, metaActionCount } from "@/lib/facebook/metaReconciliation";

async function readMetaObject(id: string, fields: string, accessToken: string) {
  if (!id) return null;
  const params = new URLSearchParams({ fields, access_token: accessToken });
  const response = await fetch(`${metaGraphUrl(id)}?${params.toString()}`, { method: "GET" });
  const json = await response.json().catch(() => ({}));
  return response.ok && !json?.error ? json : { id, readError: json?.error?.message || `HTTP ${response.status}` };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  const userEmail = String(session?.user?.email || "").toLowerCase();
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });
  await mongooseConnect();
  const campaign = await FBLeadCampaign.findOne({ _id: String(req.query.id || ""), userEmail })
    .select("campaignName status metaCampaignId metaAdsetId metaAdId ads totalSpend totalLeads totalClicks metaPublishStatus metaPublishError")
    .lean() as any;
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  const user = await User.findOne({ email: userEmail }).select("metaSystemUserToken metaAccessToken").lean() as any;
  const accessToken = String(user?.metaSystemUserToken || user?.metaAccessToken || "").trim();
  if (!accessToken) return res.status(400).json({ error: "Meta connection required" });

  const adIds = Array.from(new Set([
    String(campaign.metaAdId || ""),
    ...(Array.isArray(campaign.ads) ? campaign.ads.map((ad: any) => String(ad?.metaAdId || "")) : []),
  ].filter(Boolean)));
  const [metaCampaign, metaAdSet, ...metaAds] = await Promise.all([
    readMetaObject(String(campaign.metaCampaignId || ""), "id,name,status,effective_status,objective,special_ad_categories", accessToken),
    readMetaObject(String(campaign.metaAdsetId || ""), "id,name,status,effective_status,daily_budget,optimization_goal,billing_event,destination_type,promoted_object,attribution_spec,targeting", accessToken),
    ...adIds.map((id) => readMetaObject(id, "id,name,status,effective_status,creative{id}", accessToken)),
  ]);
  const insightTarget = String(campaign.metaCampaignId || campaign.metaAdsetId || adIds[0] || "");
  const insights = insightTarget
    ? await readMetaObject(insightTarget, "insights.date_preset(maximum){spend,impressions,clicks,actions}", accessToken)
    : null;
  const insightRow = insights?.insights?.data?.[0] || {};
  const metaEffectiveStatus = String(metaCampaign?.effective_status || metaCampaign?.status || "MISSING");
  const coveStatus = String(campaign.status || "").toUpperCase();
  const statusDrift = hasMetaStatusDrift(coveStatus, metaEffectiveStatus);
  const partialObjects = {
    missingCampaign: !campaign.metaCampaignId,
    missingAdSet: !campaign.metaAdsetId,
    missingAds: adIds.length === 0,
    publishFailedWithObjects: campaign.metaPublishStatus === "failed" && !!(campaign.metaCampaignId || campaign.metaAdsetId || adIds.length),
  };

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    authoritativeSources: { meta: "object status, creative identity, delivery and performance", cove: "CRM state and lead outcomes" },
    cove: {
      id: String(campaign._id),
      name: campaign.campaignName,
      status: campaign.status,
      recordedPerformance: { spend: campaign.totalSpend, clicks: campaign.totalClicks, leads: campaign.totalLeads },
      publishStatus: campaign.metaPublishStatus,
      publishError: campaign.metaPublishError,
    },
    meta: {
      campaign: metaCampaign,
      adSet: metaAdSet,
      ads: metaAds,
      performance: {
        spend: Number(insightRow.spend || 0),
        impressions: Number(insightRow.impressions || 0),
        clicks: Number(insightRow.clicks || 0),
        landingPageViews: metaActionCount(insightRow, ["landing_page_view"]),
        leads: metaActionCount(insightRow, ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]),
      },
    },
    drift: {
      statusDrift,
      coveStatus,
      metaEffectiveStatus,
      creativeIds: metaAds.map((ad: any) => ({ adId: ad?.id || "", creativeId: ad?.creative?.id || "", effectiveStatus: ad?.effective_status || ad?.status || "MISSING" })),
      partialObjects,
    },
  });
}
