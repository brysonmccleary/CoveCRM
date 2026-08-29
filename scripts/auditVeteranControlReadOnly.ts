import crypto from "crypto";
import dotenv from "dotenv";
import path from "path";
import mongooseConnect from "../lib/mongooseConnect";
import { metaGraphUrl } from "../lib/meta/graphApi";
import FBLeadCampaign from "../models/FBLeadCampaign";
import User from "../models/User";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value: any): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

async function readMetaObject(id: string, fields: string, token: string) {
  if (!id) return null;
  const params = new URLSearchParams({ fields, access_token: token });
  const response = await fetch(`${metaGraphUrl(id)}?${params.toString()}`);
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.error) throw new Error(`Meta read failed for ${id}: ${json?.error?.message || response.status}`);
  return json;
}

async function main() {
  const campaignId = process.argv[2] || "6a8b6a690f538226706669dc";
  await mongooseConnect();
  const campaign = await FBLeadCampaign.findById(campaignId).lean() as any;
  if (!campaign) throw new Error(`Veteran campaign ${campaignId} not found.`);
  const user = await User.findById(campaign.userId).select("metaSystemUserToken metaAccessToken").lean() as any;
  const token = String(user?.metaSystemUserToken || user?.metaAccessToken || "").trim();
  if (!token) throw new Error("Meta token unavailable for read-only control audit.");
  const adIds = [...new Set([
    String(campaign.metaAdId || ""),
    ...(campaign.ads || []).map((ad: any) => String(ad?.metaAdId || "")),
  ].filter(Boolean))];
  const [metaCampaign, metaAdSet, ...metaAds] = await Promise.all([
    readMetaObject(String(campaign.metaCampaignId || ""), "id,name,status,effective_status,objective,special_ad_categories", token),
    readMetaObject(String(campaign.metaAdsetId || ""), "id,name,status,effective_status,daily_budget,optimization_goal,billing_event,destination_type,promoted_object,attribution_spec,targeting", token),
    ...adIds.map((id) => readMetaObject(id, "id,name,status,effective_status,creative{id,name,title,body,object_story_spec,asset_feed_spec,url_tags}", token)),
  ]);
  const coveControl = {
    id: String(campaign._id), campaignName: campaign.campaignName, status: campaign.status,
    dailyBudget: campaign.dailyBudget, leadType: campaign.leadType, audienceSegment: campaign.audienceSegment,
    targetingProfileKey: campaign.targetingProfileKey, targetingPolicyVersion: campaign.targetingPolicyVersion,
    targetingQualificationMode: campaign.targetingQualificationMode, targetingDeliveryMode: campaign.targetingDeliveryMode,
    campaignType: campaign.campaignType, attributionVersion: campaign.attributionVersion,
    funnelSlug: campaign.funnelSlug, funnelStatus: campaign.funnelStatus, funnelVersion: campaign.funnelVersion,
    landingPageConfig: campaign.landingPageConfig, complianceProfile: campaign.complianceProfile,
    licensedStates: campaign.licensedStates, borderStateBehavior: campaign.borderStateBehavior,
    metaCampaignId: campaign.metaCampaignId, metaAdsetId: campaign.metaAdsetId, metaAdId: campaign.metaAdId,
    ads: (campaign.ads || []).map((ad: any) => ({
      variantId: ad.variantId, headline: ad.headline, imageUrl: ad.imageUrl, metaAdId: ad.metaAdId,
      metaCreativeId: ad.metaCreativeId, creativeFamily: ad.creativeFamily, layoutId: ad.layoutId,
      hookClass: ad.hookClass, offerClass: ad.offerClass, destinationUrl: ad.destinationUrl, status: ad.status,
    })),
  };
  const metaControl = { campaign: metaCampaign, adSet: metaAdSet, ads: metaAds };
  const report = {
    capturedAt: new Date().toISOString(), campaignId,
    cove: {
      status: campaign.status, dailyBudget: campaign.dailyBudget, leadType: campaign.leadType,
      audienceSegment: campaign.audienceSegment, funnelSlug: campaign.funnelSlug,
      metaCampaignId: campaign.metaCampaignId, metaAdsetId: campaign.metaAdsetId,
      metaAdIds: adIds, controlHash: hash(coveControl), funnelHash: hash({
        funnelSlug: campaign.funnelSlug, funnelStatus: campaign.funnelStatus,
        funnelVersion: campaign.funnelVersion, landingPageConfig: campaign.landingPageConfig,
      }),
    },
    meta: {
      campaign: { id: metaCampaign?.id, status: metaCampaign?.status, effectiveStatus: metaCampaign?.effective_status, objective: metaCampaign?.objective, specialAdCategories: metaCampaign?.special_ad_categories },
      adSet: {
        id: metaAdSet?.id, status: metaAdSet?.status, effectiveStatus: metaAdSet?.effective_status,
        dailyBudget: metaAdSet?.daily_budget, optimizationGoal: metaAdSet?.optimization_goal,
        billingEvent: metaAdSet?.billing_event, destinationType: metaAdSet?.destination_type,
        promotedObject: metaAdSet?.promoted_object, attributionSpec: metaAdSet?.attribution_spec,
      },
      ads: metaAds.map((ad: any) => ({ id: ad?.id, status: ad?.status, effectiveStatus: ad?.effective_status, creativeId: ad?.creative?.id })),
      campaignHash: hash(metaCampaign), adSetHash: hash(metaAdSet), adsHash: hash(metaAds), controlHash: hash(metaControl),
      targetingHash: hash(metaAdSet?.targeting || {}), creativeHash: hash(metaAds.map((ad: any) => ad?.creative || {})),
    },
    combinedControlHash: hash({ coveControl, metaControl }),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
