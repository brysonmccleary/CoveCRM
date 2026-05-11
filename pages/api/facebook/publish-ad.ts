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

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

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
    "Direct-response Facebook ad creative background for final expense insurance, poster-style composition, premium dark gold layout, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, clean graphic background with space for overlay, no readable text inside image, NOT lifestyle photography, NO family-photo scene, no logos",
  iul:
    "Premium direct-response IUL education ad creative background, blue gold white clean graphic layout, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, clean background with space for overlay, no readable text inside image, NOT lifestyle stock-photo style, no logos",
  mortgage_protection:
    "Direct-response mortgage protection ad creative background, home-focused poster layout, house and key visual, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, clean graphic background with space for overlay, no readable text inside image, high contrast red white navy palette, NOT lifestyle stock photography, NOT paperwork table scene, no logos",
  veteran:
    "Direct-response veteran insurance ad creative background, bold patriotic poster composition, navy and gold graphic areas, American flag texture background, veteran-aged civilian male, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, NOT lifestyle photography, NO kids, NO family portraits, NO military uniforms, NO official insignia, NO government seals, no logos",
  trucker:
    "Direct-response trucker insurance ad creative background, large semi truck hero image on highway, poster composition, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, clean graphic background with space for overlay, no readable text inside image, high contrast neon amber blue or patriotic palette, NOT stock-photo style, NO home-family scenes, no logos",
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

function isGeneratedCoveCrmDraft(draft: any) {
  return Boolean(
    draft?.winningFamilyId ||
    draft?.variationType ||
    draft?.uniquenessFingerprint ||
    draft?.vendorStyleTag ||
    draft?.landingPageConfig
  );
}

function stripRenderedCreativeData(draft: any) {
  if (!draft || typeof draft !== "object") return draft;
  const { renderedCreativeDataUrl: _renderedCreativeDataUrl, ...rest } = draft;
  return rest;
}

function sanitizeImagePrompt(prompt: string, leadType: string) {
  let sanitized = String(prompt || "");
  const replacements: Array<[RegExp, string]> = [
    [/family at home/gi, "structured direct-response ad layout"],
    [/mature family/gi, "single veteran-aged civilian subject"],
    [/young family/gi, "home-focused visual"],
    [/smiling family/gi, "structured benefit-card visual"],
    [/couple at home/gi, "home-focused visual"],
    [/couple reviewing paperwork/gi, "clean graphic background with space for overlay"],
    [/kitchen table/gi, "blank reserved CTA/button area for app-rendered UI"],
    [/cozy home/gi, "premium direct-response layout"],
    [/warm natural lighting/gi, "high-contrast direct-response lighting"],
    [/warm realistic lighting/gi, "high-contrast direct-response lighting"],
    [/warm cinematic/gi, "high-contrast direct-response"],
    [/candid family photography/gi, "poster-style ad creative"],
    [/realistic photography/gi, "graphic direct-response ad composition"],
    [/structured typography zones/gi, "blank reserved headline area for app-rendered text"],
    [/age or coverage selection buttons/gi, "blank reserved CTA/button area for app-rendered UI"],
    [/fake clickable (?:option )?buttons?/gi, "blank reserved CTA/button area for app-rendered UI"],
    [/amount card layout/gi, "clean graphic background with space for overlay"],
    [/amount-card layout/gi, "clean graphic background with space for overlay"],
    [/benefit-card composition/gi, "clean graphic background with space for overlay"],
    [/benefit-card visual/gi, "clean graphic background with space for overlay"],
    [/strong headline area/gi, "blank reserved headline area for app-rendered text"],
    [/bold headline zone/gi, "blank reserved headline area for app-rendered text"],
    [/clean CTA layout/gi, "blank reserved CTA/button area for app-rendered UI"],
  ];

  if (leadType === "veteran") {
    replacements.push(
      [/children/gi, "coverage cards"],
      [/kids/gi, "coverage cards"],
      [/family portraits?/gi, "patriotic poster composition"]
    );
  }

  if (leadType === "trucker") {
    replacements.push([/family/gi, "semi truck hero visual"]);
  }

  for (const [pattern, replacement] of replacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

async function generateImageUrlForPublish(leadType: string, imagePrompt?: string) {
  if (!openai) return "";

  const rawImagePrompt = String(imagePrompt || "").trim();
  const fallbackPrompt = IMAGE_PROMPT_FALLBACKS[leadType] || IMAGE_PROMPT_FALLBACKS.mortgage_protection;

  if (!rawImagePrompt) {
    console.warn("[publish-ad] Missing imagePrompt; using direct-response fallback", { leadType });
  }

  const prompt = sanitizeImagePrompt(
    rawImagePrompt || fallbackPrompt,
    leadType
  );

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
    renderedCreativeDataUrl,
    facebookPageId,
    adAccountId,
    drafts,
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
    renderedCreativeDataUrl?: string;
    facebookPageId?: string;
    adAccountId?: string;
    drafts?: Array<{
      leadType?: string;
      primaryText?: string;
      headline?: string;
      description?: string;
      cta?: string;
      imagePrompt?: string;
      imageUrl?: string;
      renderedCreativeDataUrl?: string;
      winningFamilyId?: string;
      variationType?: string;
      uniquenessFingerprint?: string;
      vendorStyleTag?: string;
      creativeArchetype?: string;
      landingPageConfig?: Record<string, any>;
    }>;
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
      .select("_id email name firstName lastName agentPhone numbers metaAccessToken metaSystemUserToken metaAdAccountId metaPageId metaPageName metaInstagramId metaLeadTypeAssets")
      .lean();
    if (!user) {
      return res.status(404).json({ error: "User account not found" });
    }
    const leadTypeAssets =
      leadType && (user as any)?.metaLeadTypeAssets
        ? (user as any).metaLeadTypeAssets instanceof Map
          ? (user as any).metaLeadTypeAssets.get(leadType)
          : (user as any).metaLeadTypeAssets[leadType]
        : null;
    const resolvedPageId = String(
      launchValidation.pageId ||
      facebookPageId ||
      leadTypeAssets?.pageId ||
      (user as any).metaPageId ||
      ""
    ).trim();
    const resolvedAdAccountId = String(
      launchValidation.adAccountId ||
      adAccountId ||
      leadTypeAssets?.adAccountId ||
      (user as any).metaAdAccountId ||
      ""
    ).trim().replace(/^act_/, "");
    const resolvedPageName =
      resolvedPageId && resolvedPageId === String(leadTypeAssets?.pageId || "").trim()
        ? String(leadTypeAssets?.pageName || "").trim()
        : resolvedPageId && resolvedPageId === String((user as any).metaPageId || "").trim()
          ? String((user as any).metaPageName || "").trim()
          : "";
    const agentContact = injectAgentContact(user, {
      name: publicAgentProfile?.displayName,
      phone: publicAgentProfile?.phone,
      email: (user as any).email,
    });

    const safeName = String(campaignName).trim();
    const normalizedDrafts = Array.isArray(drafts) && drafts.length > 0
      ? drafts
      : [
          {
            leadType,
            primaryText,
            headline,
            description,
            cta,
            imagePrompt,
            imageUrl,
            renderedCreativeDataUrl,
            winningFamilyId,
            variationType,
            uniquenessFingerprint,
            vendorStyleTag,
            creativeArchetype,
          },
        ];
    const generatedCoveCrmCreative = Boolean(
      winnerLandingPageConfig ||
      winningFamilyId ||
      variationType ||
      uniquenessFingerprint ||
      vendorStyleTag ||
      normalizedDrafts.some(isGeneratedCoveCrmDraft)
    );
    const funnelSlug = safeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    let resolvedImageUrl = String(
      renderedCreativeDataUrl ||
      normalizedDrafts[0]?.renderedCreativeDataUrl ||
      imageUrl ||
      normalizedDrafts[0]?.imageUrl ||
      ""
    ).trim();

    if (!resolvedImageUrl) {
      resolvedImageUrl = await generateImageUrlForPublish(leadType, imagePrompt);
    }

    if (!resolvedImageUrl) {
      return res.status(400).json({
        ok: false,
        error: "Image generation required before publish",
      });
    }

    const storedDrafts = normalizedDrafts.map(stripRenderedCreativeData);
    const storedImageUrl = String(imageUrl || normalizedDrafts[0]?.imageUrl || "").trim();

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
      imageUrl: storedImageUrl || resolvedImageUrl,
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
        const aiScriptKey =
          leadType === "mortgage_protection" ? "mortgage_protection" :
          leadType === "iul" ? "iul_cash_value" :
          leadType === "veteran" ? "veteran_leads" :
          leadType === "trucker" ? "trucker_leads" :
          "final_expense";
        folder = await Folder.create({
          name: folderName,
          userEmail,
          aiFirstCallEnabled: true,
          aiRealTimeOnly: true,
          aiScriptKey,
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
          facebookPageId: resolvedPageId,
          facebookPageName: resolvedPageName,
          adAccountId: resolvedAdAccountId,
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
            headline: headline || normalizedDrafts[0]?.headline || "",
            primaryText: primaryText || normalizedDrafts[0]?.primaryText || "",
            imagePrompt: imagePrompt || normalizedDrafts[0]?.imagePrompt || "",
            imageUrl: storedImageUrl || resolvedImageUrl,
            cta: cta || normalizedDrafts[0]?.cta || "",
            creativeArchetype: creativeArchetype || normalizedDrafts[0]?.creativeArchetype || "",
            adAccountId: resolvedAdAccountId || "",
            funnelType: funnelType || "",
            campaignStructure: lockedStructure,
            savedAt: new Date().toISOString(),
            funnelData,
            drafts: storedDrafts,
          }),
        },
      },
      { upsert: true, new: true }
    );

    let metaCampaignId = "";
    let metaAdsetId = "";
    let metaAdId = "";
    let metaFormId = "";
    let publishedAds: Array<{
      variantId: string;
      variationType: string;
      headline: string;
      imageUrl: string;
      metaAdId: string;
      metaCreativeId: string;
      status: string;
    }> = [];
    let metaPublishStatus: "not_attempted" | "skipped_missing_meta_connection" | "success" | "failed" = "not_attempted";
    let metaError: string | null = null;

    try {
      const fullUser = user as any;
      const accessToken = String(launchValidation.accessToken || "").trim();
      const adAccountIdFinal = resolvedAdAccountId;
      const pageIdFinal = resolvedPageId;
      const instagramId = String(fullUser?.metaInstagramId || "").trim();

        const campaignParams = new URLSearchParams();
        campaignParams.set("name", lockedStructure.campaign.name);
        campaignParams.set("objective", lockedStructure.campaign.objective);
        campaignParams.set("buying_type", lockedStructure.campaign.buying_type);
        campaignParams.set("status", lockedStructure.campaign.status);
        campaignParams.set("special_ad_categories", JSON.stringify(lockedStructure.campaign.special_ad_categories));
        campaignParams.set("is_adset_budget_sharing_enabled", "false");
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

        const leadTypeSpecificQuestionLabels: Record<string, string> = {
          mortgage_protection: "What is your mortgage balance?",
          trucker: "Are you currently an active CDL driver?",
          veteran: "What military branch did you serve in?",
          final_expense: "What coverage amount are you interested in?",
          iul: "Are you looking for protection, cash value growth, or both?",
        };
        const questions: Array<Record<string, any>> = [
          { type: "FULL_NAME" },
          { type: "CUSTOM", label: leadTypeSpecificQuestionLabels[leadType] },
          { type: "CUSTOM", label: "Best time for a licensed agent to call?" },
          { type: "PHONE" },
          { type: "EMAIL" },
          { type: "CUSTOM", label: "Age" },
          { type: "CUSTOM", label: "State" },
          { type: "CUSTOM", label: "Who would be your beneficiary?" },
        ];

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
        const instantFormDisplayUrl = appUrl || "https://www.covecrm.com";
        publishedAds = [];

        for (let index = 0; index < normalizedDrafts.length; index++) {
          const currentDraft = normalizedDrafts[index] || {};
          let currentImageUrl = String(
            currentDraft.renderedCreativeDataUrl ||
            currentDraft.imageUrl ||
            ""
          ).trim();
          if (!currentImageUrl) {
            currentImageUrl = await generateImageUrlForPublish(
              leadType,
              String(currentDraft.imagePrompt || imagePrompt || "")
            );
          }

          const resolvedImageBase64 = getBase64FromDataImageUrl(currentImageUrl);
          const resolvedMetaImageHash = resolvedImageBase64
            ? await uploadMetaAdImageFromDataUrl(
                adAccountIdFinal,
                accessToken,
                currentImageUrl,
                `${safeName} Creative Image ${index + 1}`
              )
            : "";

          const objectStorySpec: Record<string, any> = {
            page_id: pageIdFinal,
            link_data: {
              link: instantFormDisplayUrl,
              message: String(currentDraft.primaryText || primaryText || ""),
              name: String(currentDraft.headline || headline || ""),
              description: String(currentDraft.description || description || ""),
              call_to_action: {
                type: String(currentDraft.cta || cta || "LEARN_MORE"),
                value: {
                  lead_gen_form_id: metaFormId,
                },
              },
            },
          };

          if (resolvedMetaImageHash) {
            objectStorySpec.link_data.image_hash = resolvedMetaImageHash;
          } else {
            objectStorySpec.link_data.image_url = currentImageUrl;
          }
          if (instagramId) {
            objectStorySpec.instagram_actor_id = instagramId;
          }

          const creativeParams = new URLSearchParams();
          creativeParams.set("name", `${safeName} Creative ${index + 1}`);
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
          adParams.set("name", `${safeName} Ad ${index + 1}`);
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

          const createdMetaAdId = String(metaAdJson.id);
          if (!metaAdId) metaAdId = createdMetaAdId;
          publishedAds.push({
            variantId: String(currentDraft.uniquenessFingerprint || `variant_${index + 1}`),
            variationType: String(currentDraft.variationType || ""),
            headline: String(currentDraft.headline || headline || ""),
            imageUrl: String(currentDraft.imageUrl || ""),
            metaAdId: createdMetaAdId,
            metaCreativeId: creativeId,
            status: "PAUSED",
          });
        }

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
              ads: publishedAds,
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
      });
    }

    return res.status(200).json({
        ok: true,
        message: `Campaign created, Meta Instant Form lead ad assets created, and CRM routing ready. Meta campaign, ad set, lead form, and selected ads are in PAUSED status.`,
        campaignId,
      folderId: String(folderId),
      folderName,
      campaignName: safeName,
      leadType,
      metaCampaignId,
      metaAdsetId,
        metaFormId,
        metaAdId,
        ads: publishedAds,
        adCount: publishedAds.length,
      });
  } catch (err: any) {
    console.error("[publish-ad] error:", err?.message);
    return res.status(500).json({ ok: false, error: "Failed to create campaign", details: err?.message });
  }
}
