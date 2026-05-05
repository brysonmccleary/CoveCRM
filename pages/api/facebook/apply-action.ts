import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { Types } from "mongoose";
import OpenAI from "openai";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import mongooseConnect from "@/lib/mongooseConnect";
import type { AiAdBrainAction } from "@/lib/ai/adBrain";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import CampaignActionLog from "@/models/CampaignActionLog";
import User from "@/models/User";
import {
  generateWinningVariantList,
  isWinnerSupportedLeadType,
} from "@/lib/facebook/winningAdLibrary";

type ApplyActionType = "SCALE" | "DECREASE" | "PAUSE" | "FIX";

const MAX_BUDGET_CHANGE_PERCENT = 30;
const MIN_SPEND_TO_EXECUTE = 50;
const META_GRAPH_VERSION = "v18.0";
const META_GRAPH_CREATIVE_VERSION = "v19.0";

const IMAGE_PROMPT_FALLBACKS: Record<string, string> = {
  final_expense:
    "Vertical 1:1 Facebook ad image for final expense insurance, older couple at home, warm trustworthy realistic photography, no logos, no text overlay",
  iul:
    "Vertical 1:1 Facebook ad image for indexed universal life, confident middle-aged family in a bright home setting, premium realistic photography, no logos, no text overlay",
  mortgage_protection:
    "Vertical 1:1 Facebook ad image for mortgage protection, homeowner family in front of their house, realistic trustworthy lighting, no logos, no text overlay",
  veteran:
    "Vertical 1:1 Facebook ad image for veteran life insurance leads, mature family at home with subtle patriotic palette, realistic, no insignia, no logos, no text overlay",
  trucker:
    "Vertical 1:1 Facebook ad image for trucker insurance leads, professional truck driver with family-safe trustworthy tone, realistic photography, no logos, no text overlay",
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function actionTypeFor(action: AiAdBrainAction["action"]): ApplyActionType {
  if (action === "scale_budget") return "SCALE";
  if (action === "decrease_budget") return "DECREASE";
  if (action === "pause_campaign") return "PAUSE";
  return "FIX";
}

function getImageAssetFromOpenAIResponse(image: any) {
  const firstImage = image?.data?.[0] || {};
  const url = String(firstImage.url || "").trim();
  if (url) return url;

  const b64Json = String(firstImage.b64_json || "").trim();
  if (b64Json) return `data:image/png;base64,${b64Json}`;

  return "";
}

function getBase64FromDataImageUrl(imageAsset: string) {
  const match = String(imageAsset || "")
    .trim()
    .match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/);

  return match?.[1]?.replace(/\s/g, "") || "";
}

async function generateImageForCreative(leadType: string, imagePrompt?: string) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OpenAI API key missing for creative image generation");

  const openai = new OpenAI({ apiKey });
  const prompt =
    String(imagePrompt || "").trim() ||
    IMAGE_PROMPT_FALLBACKS[leadType] ||
    IMAGE_PROMPT_FALLBACKS.mortgage_protection;

  const image = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
  });

  const imageAsset = getImageAssetFromOpenAIResponse(image);
  if (!imageAsset) throw new Error("No usable generated image asset returned");
  return imageAsset;
}

async function uploadMetaAdImageFromDataUrl(
  adAccountId: string,
  accessToken: string,
  imageAsset: string,
  imageName: string,
) {
  const imageBase64 = getBase64FromDataImageUrl(imageAsset);
  if (!imageBase64) return "";

  const imageParams = new URLSearchParams();
  imageParams.set("bytes", imageBase64);
  imageParams.set("name", imageName);
  imageParams.set("access_token", accessToken);

  const imageResp = await fetch(
    `https://graph.facebook.com/${META_GRAPH_CREATIVE_VERSION}/act_${adAccountId}/adimages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: imageParams.toString(),
    },
  );
  const imageJson = await imageResp.json();
  const images =
    imageJson?.images && typeof imageJson.images === "object"
      ? (imageJson.images as Record<string, any>)
      : {};
  const firstImageHash = Object.values(images)
    .map((image: any) => String(image?.hash || "").trim())
    .find(Boolean);
  const imageHash = String(images.bytes?.hash || firstImageHash || imageJson?.hash || "").trim();

  if (!imageResp.ok || !imageHash) {
    throw new Error(`Meta image upload failed: ${JSON.stringify(imageJson)}`);
  }

  return imageHash;
}

async function updateCampaignBudget(params: {
  campaign: any;
  accessToken: string;
  oldBudget: number;
  newBudget: number;
  actionType: "SCALE" | "DECREASE";
  now: Date;
  reason: string;
}) {
  const budgetParams = new URLSearchParams();
  budgetParams.set("daily_budget", String(Math.round(params.newBudget * 100)));
  budgetParams.set("access_token", params.accessToken);

  const resp = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${params.campaign.metaAdsetId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: budgetParams.toString(),
    },
  );
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(`Meta budget update failed: ${JSON.stringify(json)}`);
  }

  await FBLeadCampaign.updateOne(
    { _id: params.campaign._id },
    { $set: { dailyBudget: params.newBudget, lastAutomationActionAt: params.now } },
  );

  await CampaignActionLog.create({
    userId: params.campaign.userId,
    campaignId: params.campaign._id,
    actionType: params.actionType,
    oldBudget: params.oldBudget,
    newBudget: params.newBudget,
    metaResponse: {
      ...json,
      summary: {
        source: "ai_ad_brain_apply_action",
        message: params.reason,
      },
    },
    createdAt: params.now,
  });

  return json;
}

async function createRefreshCreativeAd(params: {
  campaign: any;
  user: any;
  action: AiAdBrainAction;
  accessToken: string;
  now: Date;
}) {
  const leadType = String(params.campaign.leadType || "mortgage_protection");
  if (!isWinnerSupportedLeadType(leadType)) {
    throw new Error("Campaign lead type is not supported for creative refresh");
  }

  const campaignName = String(params.campaign.campaignName || "Campaign");
  const variants = generateWinningVariantList({
    leadType,
    audienceSegment: leadType === "veteran" || leadType === "trucker" ? leadType : "standard",
    userId: String(params.user._id || params.user.email || "user"),
    campaignName,
    location: "",
    variantCount: 2,
  });
  const variant = variants[1] || variants[0];
  if (!variant) throw new Error("No creative variant generated");

  const adAccountId = String(params.campaign.adAccountId || params.user.metaAdAccountId || "")
    .replace(/^act_/, "")
    .trim();
  const pageId = String(
    params.campaign.facebookPageId || params.user.metaPageId || "",
  ).trim();
  const metaFormId = String(params.campaign.metaFormId || "").trim();

  if (!adAccountId) throw new Error("Meta ad account missing");
  if (!pageId) throw new Error("Facebook page missing");
  if (!metaFormId) throw new Error("Existing Meta lead form missing");

  const imagePrompt = [
    params.action.suggestedCreativeAngle,
    variant.imagePrompt,
  ]
    .filter(Boolean)
    .join(". ");
  const imageAsset = await generateImageForCreative(leadType, imagePrompt);
  const imageHash = await uploadMetaAdImageFromDataUrl(
    adAccountId,
    params.accessToken,
    imageAsset,
    `${campaignName} AI Refresh ${params.now.getTime()}`,
  );

  const appUrl = String(
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://www.covecrm.com",
  ).replace(/\/$/, "");
  const funnelUrl = `${appUrl}/f/${String(params.campaign._id)}`;

  const objectStorySpec: Record<string, any> = {
    page_id: pageId,
    link_data: {
      link: funnelUrl,
      message: String(variant.primaryText || ""),
      name: String(variant.headline || campaignName),
      description: String(variant.description || ""),
      call_to_action: {
        type: String(variant.cta || "LEARN_MORE"),
        value: {
          lead_gen_form_id: metaFormId,
          link: funnelUrl,
        },
      },
    },
  };

  if (imageHash) {
    objectStorySpec.link_data.image_hash = imageHash;
  } else {
    objectStorySpec.link_data.image_url = imageAsset;
  }

  const creativeParams = new URLSearchParams();
  creativeParams.set("name", `${campaignName} AI Refresh Creative`);
  creativeParams.set("object_story_spec", JSON.stringify(objectStorySpec));
  creativeParams.set("access_token", params.accessToken);

  const creativeResp = await fetch(
    `https://graph.facebook.com/${META_GRAPH_CREATIVE_VERSION}/act_${adAccountId}/adcreatives`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: creativeParams.toString(),
    },
  );
  const creativeJson = await creativeResp.json();
  if (!creativeResp.ok || !creativeJson?.id) {
    throw new Error(`Meta creative create failed: ${JSON.stringify(creativeJson)}`);
  }

  const creativeId = String(creativeJson.id);
  const adParams = new URLSearchParams();
  adParams.set("name", `${campaignName} AI Refresh Ad`);
  adParams.set("adset_id", String(params.campaign.metaAdsetId));
  adParams.set("creative", JSON.stringify({ creative_id: creativeId }));
  adParams.set("status", "PAUSED");
  adParams.set("access_token", params.accessToken);

  const adResp = await fetch(
    `https://graph.facebook.com/${META_GRAPH_CREATIVE_VERSION}/act_${adAccountId}/ads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: adParams.toString(),
    },
  );
  const adJson = await adResp.json();
  if (!adResp.ok || !adJson?.id) {
    throw new Error(`Meta ad create failed: ${JSON.stringify(adJson)}`);
  }

  const createdAd = {
    variantId: String(variant.uniquenessFingerprint || `ai_refresh_${params.now.getTime()}`),
    variationType: String(variant.variantType || "ai_refresh"),
    headline: String(variant.headline || campaignName),
    imageUrl: imageAsset,
    metaAdId: String(adJson.id),
    metaCreativeId: creativeId,
    status: "PAUSED",
    spend: 0,
    leads: 0,
    clicks: 0,
    cpl: 0,
    appointmentsBooked: 0,
    sales: 0,
  };

  await FBLeadCampaign.updateOne(
    { _id: params.campaign._id },
    {
      $push: { ads: createdAd },
      $set: {
        creativeRefreshNeeded: false,
        lastAutomationActionAt: params.now,
      },
    },
  );

  await CampaignActionLog.create({
    userId: params.campaign.userId,
    campaignId: params.campaign._id,
    actionType: "FIX",
    oldBudget: num(params.campaign.dailyBudget),
    newBudget: num(params.campaign.dailyBudget),
    metaResponse: {
      creative: creativeJson,
      ad: adJson,
      summary: {
        source: "ai_ad_brain_apply_action",
        message: "New paused creative refresh ad created under existing ad set.",
        reason: params.action.reason,
      },
    },
    createdAt: params.now,
  });

  return createdAd;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return res.status(403).json({ error: 'Forbidden' });
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const action = (req.body || {}).action as AiAdBrainAction | undefined;
  if (!action || typeof action !== "object") {
    return res.status(400).json({ error: "Missing action" });
  }

  const campaignId = String(action.campaignId || "").trim();
  if (!Types.ObjectId.isValid(campaignId)) {
    return res.status(400).json({ error: "Invalid campaignId" });
  }

  await mongooseConnect();

  const user = (await User.findOne({ email })
    .select("_id email metaAccessToken metaSystemUserToken metaAdAccountId metaPageId")
    .lean()) as any;
  if (!user?._id) return res.status(404).json({ error: "User not found" });

  const campaign = (await FBLeadCampaign.findOne({
    _id: new Types.ObjectId(campaignId),
    $or: [{ userEmail: email }, { userId: user._id }],
  }).lean()) as any;

  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (num(campaign.totalSpend) < MIN_SPEND_TO_EXECUTE) {
    return res.status(400).json({ error: "Execution blocked: campaign spend is below $50" });
  }

  if (!String(campaign.metaAdsetId || "").trim()) {
    return res.status(400).json({ error: "Execution blocked: campaign is missing metaAdsetId" });
  }

  const accessToken = String(user.metaSystemUserToken || user.metaAccessToken || "").trim();
  if (!accessToken) {
    return res.status(400).json({ error: "Execution blocked: Meta access token missing" });
  }

  const now = new Date();
  const oldBudget = num(campaign.dailyBudget);
  const actionName = String(action.action || "");

  try {
    if (actionName === "scale_budget" || actionName === "decrease_budget") {
      if (oldBudget <= 0) {
        return res.status(400).json({ error: "Campaign dailyBudget must be greater than 0" });
      }

      const rawPercent = Math.abs(num(action.suggestedBudgetChangePercent || 20));
      const percent = clamp(rawPercent, 0, MAX_BUDGET_CHANGE_PERCENT);
      const multiplier =
        actionName === "scale_budget" ? 1 + percent / 100 : 1 - percent / 100;
      const newBudget = Number((oldBudget * multiplier).toFixed(2));

      const metaResponse = await updateCampaignBudget({
        campaign,
        accessToken,
        oldBudget,
        newBudget,
        actionType: actionName === "scale_budget" ? "SCALE" : "DECREASE",
        now,
        reason: action.reason,
      });

      return res.status(200).json({
        ok: true,
        action: action.action,
        message:
          actionName === "scale_budget"
            ? "Campaign budget increased successfully"
            : "Campaign budget decreased successfully",
        oldBudget,
        newBudget,
        metaResponse,
      });
    }

    if (actionName === "pause_campaign") {
      if (!String(campaign.metaCampaignId || "").trim()) {
        return res.status(400).json({ error: "Campaign is missing metaCampaignId" });
      }

      const pauseParams = new URLSearchParams();
      pauseParams.set("status", "PAUSED");
      pauseParams.set("access_token", accessToken);

      const resp = await fetch(
        `https://graph.facebook.com/${META_GRAPH_VERSION}/${campaign.metaCampaignId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: pauseParams.toString(),
        },
      );
      const json = await resp.json();
      if (!resp.ok) {
        return res.status(500).json({ error: `Meta pause failed: ${JSON.stringify(json)}` });
      }

      await FBLeadCampaign.updateOne(
        { _id: campaign._id },
        { $set: { status: "paused", lastAutomationActionAt: now } },
      );

      await CampaignActionLog.create({
        userId: campaign.userId,
        campaignId: campaign._id,
        actionType: "PAUSE",
        oldBudget,
        newBudget: oldBudget,
        metaResponse: {
          ...json,
          summary: {
            source: "ai_ad_brain_apply_action",
            message: action.reason,
          },
        },
        createdAt: now,
      });

      return res.status(200).json({
        ok: true,
        action: action.action,
        message: "Campaign paused successfully",
      });
    }

    if (actionName === "refresh_creative") {
      const createdAd = await createRefreshCreativeAd({
        campaign,
        user,
        action,
        accessToken,
        now,
      });

      return res.status(200).json({
        ok: true,
        action: action.action,
        message: "New ad created successfully",
        ad: createdAd,
      });
    }

    if (actionName === "duplicate_test") {
      await CampaignActionLog.create({
        userId: campaign.userId,
        campaignId: campaign._id,
        actionType: "FIX",
        oldBudget,
        newBudget: oldBudget,
        metaResponse: {
          summary: {
            source: "ai_ad_brain_apply_action",
            skipped: true,
            message: "Duplicate test execution is not implemented in apply-action yet.",
            reason: action.reason,
          },
        },
        createdAt: now,
      });

      return res.status(400).json({
        error: "duplicate_test is advisory only in this endpoint version",
      });
    }

    return res.status(400).json({ error: "Unsupported AI Ad Brain action" });
  } catch (err: any) {
    await CampaignActionLog.create({
      userId: campaign.userId,
      campaignId: campaign._id,
      actionType: actionTypeFor(action.action),
      oldBudget,
      newBudget: oldBudget,
      metaResponse: {
        summary: {
          source: "ai_ad_brain_apply_action",
          failed: true,
          message: String(err?.message || err || "Action failed"),
        },
      },
      createdAt: now,
    });

    return res.status(500).json({ error: String(err?.message || "Action failed") });
  }
}
