// pages/api/facebook/publish-ad.ts
// Creates internal FBLeadCampaign + CRM folder, attempts full Meta API publish,
// generates auto-hosted funnel page data, and returns funnelUrl.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import OpenAI from "openai";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import Folder from "@/models/Folder";
import User from "@/models/User";
import { getCreativeRules } from "@/lib/facebook/creativeStyleRules";
import type { LeadType as CreativeLeadType } from "@/lib/facebook/creativeStyleRules";
import { isWinnerSupportedLeadType } from "@/lib/facebook/winningAdLibrary";
import { getCanonicalHeaders, getLeadSheetType } from "@/lib/facebook/sheets/sheetHeaders";
import { validateStates } from "@/lib/facebook/guardrails";
import { validateLaunchInput } from "@/pages/api/facebook/validate-launch";
import { injectAgentContact } from "@/lib/funnels/injectAgentContact";

const VALID_LEAD_TYPES = [
  "final_expense",
  "iul",
  "mortgage_protection",
  "veteran",
  "trucker",
];

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

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

async function generateImageUrlForPublish(leadType: string, imagePrompt?: string) {
  if (!openai) return "";

  const prompt =
    String(imagePrompt || "").trim() ||
    IMAGE_PROMPT_FALLBACKS[leadType] ||
    IMAGE_PROMPT_FALLBACKS.mortgage_protection;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const image = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
      });
      const imageAsset = getImageAssetFromOpenAIResponse(image);
      if (imageAsset) return imageAsset;
    } catch (err: any) {
      console.warn("[publish-ad] image generation attempt failed:", err?.message || err);
    }
  }

  return "";
}

async function uploadMetaAdImageFromDataUrl(
  adAccountId: string,
  accessToken: string,
  imageAsset: string,
  imageName: string
) {
  const imageBase64 = getBase64FromDataImageUrl(imageAsset);
  if (!imageBase64) {
    throw new Error("No usable generated image asset was available for Meta creative upload");
  }

  const imageParams = new URLSearchParams();
  imageParams.set("bytes", imageBase64);
  imageParams.set("name", imageName);
  imageParams.set("access_token", accessToken);

  const imageResp = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountId}/adimages`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: imageParams.toString(),
  });
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    leadType,
    campaignName,
    dailyBudgetCents,
    primaryText,
    headline,
    description,
    cta,
    imagePrompt,
    imageUrl,
    facebookPageId,
    adAccountId,
    creativeArchetype,
    // Winner fields — sent by generate-ad when winner library was used
    winningFamilyId,
    variationType,
    uniquenessFingerprint,
    landingPageConfig: winnerLandingPageConfig,
    benefitBullets: winnerBenefitBullets,
    buttonLabels: winnerButtonLabels,
    vendorStyleTag,
    licensedStates,
    borderStateBehavior,
    stateRestrictionNoticeAccepted,
    publicAgentProfile,
    complianceProfile,
    funnelType,
  } = req.body as {
    leadType?: string;
    campaignName?: string;
    dailyBudgetCents?: number;
    primaryText?: string;
    headline?: string;
    description?: string;
    cta?: string;
    imagePrompt?: string;
    imageUrl?: string;
    facebookPageId?: string;
    adAccountId?: string;
    creativeArchetype?: string;
    winningFamilyId?: string;
    variationType?: string;
    uniquenessFingerprint?: string;
    landingPageConfig?: {
      pageType?: string;
      headline?: string;
      subheadline?: string;
      buttonLabels?: string[];
      benefitBullets?: string[];
      ctaStrip?: string;
      theme?: { background?: string; accent?: string; styleTag?: string };
    };
    benefitBullets?: string[];
    buttonLabels?: string[];
    vendorStyleTag?: string;
    licensedStates?: string[];
    borderStateBehavior?: "allow_with_warning" | "block";
    stateRestrictionNoticeAccepted?: boolean;
    publicAgentProfile?: Record<string, string>;
    complianceProfile?: Record<string, string>;
    funnelType?: string;
  };

  // Validate required fields
  if (!campaignName || String(campaignName).trim().length < 3) {
    return res.status(400).json({ error: "campaignName is required (min 3 chars)" });
  }
  if (!leadType || !VALID_LEAD_TYPES.includes(leadType)) {
    return res.status(400).json({ error: `Valid leadType is required. Got: ${leadType}` });
  }
  if (!primaryText || String(primaryText).trim().length < 10) {
    return res.status(400).json({ error: "primaryText is required (min 10 chars)" });
  }
  if (!headline || String(headline).trim().length < 3) {
    return res.status(400).json({ error: "headline is required (min 3 chars)" });
  }
  const budgetCents = Number(dailyBudgetCents) || 0;
  if (budgetCents < 500) {
    return res.status(400).json({ error: "dailyBudgetCents must be >= 500 ($5.00/day minimum)" });
  }
  let normalizedLicensedStates: string[] = [];
  try {
    normalizedLicensedStates = validateStates(licensedStates);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Licensed states required" });
  }
  if (!stateRestrictionNoticeAccepted) {
    return res.status(400).json({ error: "State restriction notice must be acknowledged before publishing." });
  }

  try {
    const launchValidation = await validateLaunchInput({
      userEmail: session.user.email,
      body: req.body,
    });
    normalizedLicensedStates = launchValidation.licensedStates;
    const lockedStructure = launchValidation.structure;

    const userEmail = String(session.user.email).toLowerCase();
    const user = await User.findOne({ email: userEmail })
      .select("_id email name firstName lastName agentPhone numbers metaAccessToken metaSystemUserToken metaAdAccountId metaPageId metaInstagramId")
      .lean();
    if (!user) {
      return res.status(404).json({ error: "User account not found" });
    }
    const agentContact = injectAgentContact(user, {
      name: publicAgentProfile?.displayName,
      phone: publicAgentProfile?.phone,
      email: (user as any).email,
    });

    const safeName = String(campaignName).trim();
    const funnelSlug = safeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    let resolvedImageUrl = String(imageUrl || "").trim();

    if (!resolvedImageUrl) {
      resolvedImageUrl = await generateImageUrlForPublish(leadType, imagePrompt);
    }

    if (!resolvedImageUrl) {
      return res.status(400).json({
        ok: false,
        error: "Image generation required before publish",
      });
    }

    // Build auto-hosted funnel content.
    // For winner-supported lead types: use the winner landing page config passed from generate-ad.
    // For unsupported types (IUL, etc.): fall back to getCreativeRules() blueprint.
    // Stored in the campaign record; served at /f/{campaignId}.
    const creativeLeadType = (VALID_LEAD_TYPES.includes(String(leadType)) ? leadType : "mortgage_protection") as CreativeLeadType;
    const allArchetypeRules = getCreativeRules(creativeLeadType);
    const primaryRule = allArchetypeRules[0];

    const useWinnerConfig = isWinnerSupportedLeadType(String(leadType)) && !!winnerLandingPageConfig;
    const sheetType = getLeadSheetType(leadType);

    const funnelData = {
      leadType,
      campaignName: safeName,
      // Headline: prefer winner landing page config, then ad headline, then archetype rule
      headline: (useWinnerConfig ? winnerLandingPageConfig!.headline : null)
        ?? primaryRule.overlayData.headline,
      subheadline: (useWinnerConfig ? winnerLandingPageConfig!.subheadline : null)
        ?? primaryRule.overlayData.subheadline,
      buttonLabels: (useWinnerConfig ? winnerLandingPageConfig!.buttonLabels : null)
        ?? winnerButtonLabels
        ?? primaryRule.overlayData.buttonLabels,
      ctaStrip: (useWinnerConfig ? winnerLandingPageConfig!.ctaStrip : null)
        ?? primaryRule.overlayData.ctaStrip,
      benefitBullets: (useWinnerConfig ? winnerLandingPageConfig!.benefitBullets : null)
        ?? winnerBenefitBullets
        ?? primaryRule.overlayData.benefitBullets,
      ctaStyle: primaryRule.ctaStyle,
      buttonStyle: primaryRule.buttonStyle,
      colorDirection: (useWinnerConfig ? winnerLandingPageConfig!.theme?.styleTag : null)
        ?? primaryRule.colorDirection,
      adHeadline: headline || "",
      adPrimaryText: primaryText || "",
      imageUrl: resolvedImageUrl,
      creativeArchetype: creativeArchetype || winningFamilyId || primaryRule.archetype,
      generatedAt: new Date().toISOString(),
      // Winner metadata — used by the funnel renderer for family-matched styling
      pageType: useWinnerConfig ? (winnerLandingPageConfig!.pageType || "") : "",
      vendorStyleTag: vendorStyleTag || "",
      winningFamilyId: winningFamilyId || "",
      variationType: variationType || "",
      uniquenessFingerprint: uniquenessFingerprint || "",
    };

    // 1. Ensure CRM folder exists — convention: "FB: {campaignName}"
    //    This matches what the webhook uses for lead routing.
    const folderName = `FB: ${safeName}`;
    let folder: any = null;
    let folderError: string | null = null;
    try {
      folder = await Folder.findOne({ userEmail, name: folderName }).lean();
      if (!folder) {
        folder = await Folder.create({
          name: folderName,
          userEmail,
          createdAt: new Date(),
        });
      }
    } catch (err: any) {
      folderError = err?.message || "Folder creation failed";
      console.error("[publish-ad] folder error:", folderError);
    }

    if (!folder) {
      return res.status(500).json({
        ok: false,
        error: "Failed to create CRM folder",
        partialResults: { folderError },
      });
    }

    const folderId = folder._id;

    // 2. Create or update FBLeadCampaign (upsert by userEmail + campaignName to avoid duplicates)
    const campaign = await FBLeadCampaign.findOneAndUpdate(
      { userEmail, campaignName: safeName },
      {
        $setOnInsert: {
          userId: (user as any)._id,
          status: "setup",
          plan: "manager",
        },
        $set: {
          leadType,
          dailyBudget: Math.round(budgetCents / 100),
          folderId,
          ...(facebookPageId ? { facebookPageId } : {}),
          funnelStatus: "active",
          funnelSlug,
          funnelVersion: "2026-04-production-v1",
          landingPageConfig: funnelData,
          licensedStates: normalizedLicensedStates,
          borderStateBehavior: borderStateBehavior === "allow_with_warning" ? "allow_with_warning" : "block",
          stateRestrictionNoticeAccepted: true,
          publicAgentProfile: {
            displayName: agentContact.name,
            businessName: String(publicAgentProfile?.businessName || "").trim(),
            phone: agentContact.phone,
            stateLabel: normalizedLicensedStates.join(", "),
            logoUrl: String(publicAgentProfile?.logoUrl || "").trim(),
            headshotUrl: String(publicAgentProfile?.headshotUrl || "").trim(),
          },
          complianceProfile: {
            disclaimerText:
              String(complianceProfile?.disclaimerText || "").trim() ||
              "Availability varies by state and carrier. This is a no-obligation review with a licensed agent.",
            consentText:
              String(complianceProfile?.consentText || "").trim() ||
              "By submitting, you agree to be contacted by phone, text, or email by a licensed insurance agent. Consent is not a condition of purchase.",
            privacyUrl: String(complianceProfile?.privacyUrl || "").trim(),
            termsUrl: String(complianceProfile?.termsUrl || "").trim(),
          },
          leadSheetType: sheetType,
          expectedSheetHeaders: getCanonicalHeaders(sheetType),
          writeLeadsToSheet: true,
          // Store ad copy metadata + auto-generated funnel data.
          // Funnel data is served at /f/{campaignId} as the hosted landing page.
          notes: JSON.stringify({
            headline: headline || "",
            primaryText: primaryText || "",
            imagePrompt: imagePrompt || "",
            imageUrl: resolvedImageUrl,
            cta: cta || "",
            creativeArchetype: creativeArchetype || "",
            adAccountId: adAccountId || "",
            funnelType: funnelType || "",
            campaignStructure: lockedStructure,
            savedAt: new Date().toISOString(),
            funnelData,
          }),
        },
      },
      { upsert: true, new: true }
    );

    let metaCampaignId = "";
    let metaAdsetId = "";
    let metaAdId = "";
    let metaFormId = "";
    let metaPublishStatus: "not_attempted" | "skipped_missing_meta_connection" | "success" | "failed" = "not_attempted";
    let metaError: string | null = null;

    try {
      const fullUser = user as any;
      const accessToken = String(launchValidation.accessToken || "").trim();
      const adAccountIdFinal = String(launchValidation.adAccountId || "").trim().replace(/^act_/, "");
      const pageIdFinal = String(launchValidation.pageId || "").trim();
      const instagramId = String(fullUser?.metaInstagramId || "").trim();

        const campaignParams = new URLSearchParams();
        campaignParams.set("name", lockedStructure.campaign.name);
        campaignParams.set("objective", lockedStructure.campaign.objective);
        campaignParams.set("buying_type", lockedStructure.campaign.buying_type);
        campaignParams.set("status", lockedStructure.campaign.status);
        campaignParams.set("special_ad_categories", JSON.stringify(lockedStructure.campaign.special_ad_categories));
        campaignParams.set("access_token", accessToken);

        const metaCampaignResp = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountIdFinal}/campaigns`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: campaignParams.toString(),
        });
        const metaCampaignJson = await metaCampaignResp.json();

        if (!metaCampaignResp.ok || !metaCampaignJson?.id) {
          throw new Error(`Meta campaign create failed: ${JSON.stringify(metaCampaignJson)}`);
        }
        metaCampaignId = String(metaCampaignJson.id);

        const adsetParams = new URLSearchParams();
        adsetParams.set("name", lockedStructure.adSet.name);
        adsetParams.set("campaign_id", metaCampaignId);
        adsetParams.set("daily_budget", String(lockedStructure.adSet.daily_budget));
        adsetParams.set("billing_event", lockedStructure.adSet.billing_event);
        adsetParams.set("optimization_goal", lockedStructure.adSet.optimization_goal);
        adsetParams.set("bid_strategy", lockedStructure.adSet.bid_strategy);
        adsetParams.set("status", lockedStructure.adSet.status);
        adsetParams.set("promoted_object", JSON.stringify({ page_id: pageIdFinal }));
        adsetParams.set("targeting", JSON.stringify({
          ...lockedStructure.adSet.targeting,
          age_min: 30,
          age_max: 80,
        }));
        adsetParams.set("access_token", accessToken);

        const metaAdsetResp = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountIdFinal}/adsets`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: adsetParams.toString(),
        });
        const metaAdsetJson = await metaAdsetResp.json();

        if (!metaAdsetResp.ok || !metaAdsetJson?.id) {
          throw new Error(`Meta ad set create failed: ${JSON.stringify(metaAdsetJson)}`);
        }
        metaAdsetId = String(metaAdsetJson.id);

        const questions: Array<Record<string, any>> = [
          { type: "FULL_NAME" },
          { type: "PHONE" },
        ];
        if (leadType === "iul" || leadType === "final_expense") {
          questions.push({ type: "EMAIL" });
        }

        const metaFormParams = new URLSearchParams();
        metaFormParams.set("name", `${safeName} Lead Form`);
        metaFormParams.set("locale", "en_US");
        metaFormParams.set("privacy_policy_url", "https://www.covecrm.com/privacy");
        metaFormParams.set("follow_up_action_url", "https://www.covecrm.com/thank-you");
        metaFormParams.set("questions", JSON.stringify(questions));
        metaFormParams.set("access_token", accessToken);

        const metaFormResp = await fetch(`https://graph.facebook.com/v19.0/${pageIdFinal}/leadgen_forms`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: metaFormParams.toString(),
        });
        const metaFormJson = await metaFormResp.json();

        if (!metaFormResp.ok || !metaFormJson?.id) {
          throw new Error(`Meta lead form create failed: ${JSON.stringify(metaFormJson)}`);
        }
        metaFormId = String(metaFormJson.id);
        const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://www.covecrm.com").replace(/\/$/, "");
        const funnelAbsoluteUrl = `${appUrl}/f/${String(campaign._id)}`;
        const resolvedImageBase64 = getBase64FromDataImageUrl(resolvedImageUrl);
        const resolvedMetaImageHash = resolvedImageBase64
          ? await uploadMetaAdImageFromDataUrl(
              adAccountIdFinal,
              accessToken,
              resolvedImageUrl,
              `${safeName} Creative Image`
            )
          : "";

        const objectStorySpec: Record<string, any> = {
          page_id: pageIdFinal,
          link_data: {
            link: funnelAbsoluteUrl,
            message: String(primaryText || ""),
            name: String(headline || ""),
            description: String(description || ""),
            call_to_action: {
              type: String(cta || "LEARN_MORE"),
              value: {
                lead_gen_form_id: metaFormId,
                link: funnelAbsoluteUrl,
              },
            },
          },
        };

        if (resolvedMetaImageHash) {
          objectStorySpec.link_data.image_hash = resolvedMetaImageHash;
        } else {
          objectStorySpec.link_data.image_url = resolvedImageUrl;
        }
        if (instagramId) {
          objectStorySpec.instagram_actor_id = instagramId;
        }

        const creativeParams = new URLSearchParams();
        creativeParams.set("name", `${safeName} Creative`);
        creativeParams.set("object_story_spec", JSON.stringify(objectStorySpec));
        creativeParams.set("access_token", accessToken);

        const metaCreativeResp = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountIdFinal}/adcreatives`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: creativeParams.toString(),
        });
        const metaCreativeJson = await metaCreativeResp.json();

        if (!metaCreativeResp.ok || !metaCreativeJson?.id) {
          throw new Error(`Meta creative create failed: ${JSON.stringify(metaCreativeJson)}`);
        }
        const creativeId = String(metaCreativeJson.id);

        const adParams = new URLSearchParams();
        adParams.set("name", `${safeName} Ad`);
        adParams.set("adset_id", metaAdsetId);
        adParams.set("creative", JSON.stringify({ creative_id: creativeId }));
        adParams.set("status", "PAUSED");
        adParams.set("access_token", accessToken);

        const metaAdResp = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountIdFinal}/ads`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: adParams.toString(),
        });
        const metaAdJson = await metaAdResp.json();

        if (!metaAdResp.ok || !metaAdJson?.id) {
          throw new Error(`Meta ad create failed: ${JSON.stringify(metaAdJson)}`);
        }
        metaAdId = String(metaAdJson.id);

        const now = new Date();
        await FBLeadCampaign.updateOne(
          { _id: campaign._id },
          {
            $set: {
              metaCampaignId,
              metaAdsetId,
              metaFormId,
              metaAdId,
              facebookCampaignId: metaCampaignId,
              metaPublishStatus: "success",
              metaPublishError: "",
              metaLastPublishAttemptAt: now,
              metaLastPublishSuccessAt: now,
              metaObjectHealth: "paused_on_meta",
            },
          }
        );

        metaPublishStatus = "success";
    } catch (err: any) {
      metaPublishStatus = "failed";
      metaError = err?.message || "Meta publish failed";
      console.error("[publish-ad] meta publish error:", metaError);
    }

    // Persist publish diagnostics for non-success outcomes
    if (metaPublishStatus !== "success") {
      await FBLeadCampaign.updateOne(
        { _id: campaign._id },
        {
          $set: {
            metaPublishStatus,
            metaPublishError: metaError || "",
            metaLastPublishAttemptAt: new Date(),
            metaObjectHealth: "sync_failed",
          },
        }
      ).catch((e: any) => console.warn("[publish-ad] diagnostics update failed:", e?.message));
    }

    const campaignId = String(campaign._id);
    const funnelUrl = `/f/${campaignId}`;

    if (metaPublishStatus === "failed") {
      return res.status(500).json({
        ok: false,
        error: "Meta publish failed",
        metaError,
        metaCampaignId,
        metaAdsetId,
        metaFormId,
        metaAdId,
        campaignId,
        funnelUrl,
      });
    }

    return res.status(200).json({
      ok: true,
      message: `Campaign created, Meta assets created, hosted funnel live, and CRM routing ready. Meta campaign, ad set, lead form, and ad are in PAUSED status.`,
      campaignId,
      folderId: String(folderId),
      folderName,
      campaignName: safeName,
      leadType,
      funnelUrl,
      metaCampaignId,
      metaAdsetId,
      metaFormId,
      metaAdId,
    });
  } catch (err: any) {
    console.error("[publish-ad] error:", err?.message);
    return res.status(500).json({ ok: false, error: "Failed to create campaign", details: err?.message });
  }
}
