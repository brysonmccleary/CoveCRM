// pages/api/facebook/publish-ad.ts
// Creates internal FBLeadCampaign + CRM folder, attempts full Meta API publish,
// generates auto-hosted funnel page data, and returns funnelUrl.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
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
import { checkMetaWriteReadiness, markMetaHealthFailure } from "@/lib/meta/metaHealth";
import { buildLaunchFingerprint, requireDailyBudgetCents } from "@/lib/facebook/launchFingerprint";
import { verifyMetaAdset } from "@/lib/facebook/metaAdsetVerification";
import { claimLaunchCampaign, releaseLaunchCampaignClaim } from "@/lib/facebook/claimLaunchCampaign";
import { signHostedAttributionToken } from "@/lib/facebook/hostedAttribution";
import {
  buildLandingPageSnapshot,
  DEFAULT_META_CLAIMS,
  evaluateCreativeClaims,
  requiredQualifierTextsForCreative,
} from "@/lib/facebook/claimsRegistry";
import { writeImmutableMetaLaunchArchive } from "@/lib/facebook/archiveMetaLaunch";
import { metaGraphUrl } from "@/lib/meta/graphApi";
import {
  claimNativeLeadFormTemplate,
  failNativeLeadFormTemplate,
  finalizeNativeLeadFormTemplate,
  verifyNativeLeadFormQualitySettings,
  type NativeLeadFormSpecification,
} from "@/lib/facebook/metaLeadFormTemplate";
import {
  buildMetaCreativeEnhancementSpec,
  getMetaLaunchPublicMessage,
} from "@/lib/facebook/publicMetaErrors";
import {
  claimCreativeSet,
  finalizeCreativeReservation,
  releaseCreativeSet,
  type CreativeReservation,
} from "@/lib/facebook/creativeUsage";
import { hasRequiredCreativeTreatmentMix } from "@/lib/facebook/creativeCandidateSelection";
import { resolveAudienceSegment } from "@/lib/facebook/audienceTargeting";

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
const EXPECTED_CREATIVE_WIDTH = 1080;
const EXPECTED_CREATIVE_HEIGHT = 1350;

function getBase64FromDataImageUrl(imageAsset: string) {
  const match = String(imageAsset || "")
    .trim()
    .match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/);

  return match?.[1]?.replace(/\s/g, "") || "";
}

function getLeadSpecificQuestion(leadType: string, audienceSegment: string): { label: string; key: string } {
  if (audienceSegment === "spanish") {
    const spanishMap: Record<string, { label: string; key: string }> = {
      mortgage_protection: { label: "¿Cuál es el saldo aproximado de su hipoteca?", key: "mortgage_balance" },
      final_expense: { label: "¿Qué cantidad de cobertura le interesa?", key: "coverage_amount" },
      iul: { label: "¿Busca protección, potencial de valor en efectivo o ambos?", key: "iul_goal" },
    };
    return spanishMap[leadType] || { label: "¿Qué le interesa más?", key: "lead_question" };
  }
  if (audienceSegment === "veteran") {
    return { label: "What military branch did you serve in?", key: "military_branch" };
  }
  if (audienceSegment === "trucker") {
    return { label: "Are you currently an active CDL driver?", key: "cdl_driver_status" };
  }
  const map: Record<string, { label: string; key: string }> = {
    mortgage_protection: { label: "What is your mortgage balance?", key: "mortgage_balance" },
    final_expense: { label: "What coverage amount are you interested in?", key: "coverage_amount" },
    iul: { label: "Are you looking for protection, cash value growth, or both?", key: "iul_goal" },
    veteran: { label: "What military branch did you serve in?", key: "military_branch" },
    trucker: { label: "Are you currently an active CDL driver?", key: "cdl_driver_status" },
  };
  return map[leadType] || { label: "What are you most interested in?", key: "lead_question" };
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

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const isPng =
    imageBuffer.length >= 24 &&
    imageBuffer[0] === 0x89 &&
    imageBuffer[1] === 0x50 &&
    imageBuffer[2] === 0x4e &&
    imageBuffer[3] === 0x47 &&
    imageBuffer[4] === 0x0d &&
    imageBuffer[5] === 0x0a &&
    imageBuffer[6] === 0x1a &&
    imageBuffer[7] === 0x0a;
  const width = isPng ? imageBuffer.readUInt32BE(16) : 0;
  const height = isPng ? imageBuffer.readUInt32BE(20) : 0;
  if (!isPng || width !== EXPECTED_CREATIVE_WIDTH || height !== EXPECTED_CREATIVE_HEIGHT) {
    throw new Error(
      `Creative image invalid: expected ${EXPECTED_CREATIVE_WIDTH}x${EXPECTED_CREATIVE_HEIGHT} PNG, got ${width}x${height}`
    );
  }

  const imageParams = new URLSearchParams();
  imageParams.set("bytes", imageBase64);
  imageParams.set("name", imageName);
  imageParams.set("access_token", accessToken);

  const imageResp = await fetch(metaGraphUrl(`act_${adAccountId}/adimages`), {
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
    performanceGoal,
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
      creativeSignature?: string;
      vendorStyleTag?: string;
      creativeArchetype?: string;
      displayAmount?: string;
      visualVariantIndex?: number;
      visualTreatment?: "photo" | "graphic";
      generationNonce?: string;
      regenerationAttempt?: number;
      buttonLabels?: string[];
      bulletPoints?: string[];
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
    performanceGoal?: "LEAD_GENERATION" | "QUALITY_LEAD";
  };

  let audienceSegment = "standard";
  try {
    audienceSegment = resolveAudienceSegment({
      leadType,
      audienceSegment: (req.body as any).audienceSegment,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Invalid audience segment" });
  }
  const campaignType = String((req.body as any).campaignType || "hosted_funnel").trim();

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
  let budgetCents = 0;
  try {
    budgetCents = requireDailyBudgetCents(dailyBudgetCents);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Invalid dailyBudgetCents" });
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
  if (Array.isArray(drafts) && drafts.length > 0) {
    const launchVisualLeadType = audienceSegment === "veteran" || audienceSegment === "trucker"
      ? audienceSegment
      : leadType;
    const photoPoolAvailable = ["veteran", "trucker", "mortgage_protection"].includes(launchVisualLeadType);
    if (!hasRequiredCreativeTreatmentMix(drafts, photoPoolAvailable)) {
      return res.status(409).json({
        ok: false,
        error: "This generated set is missing its required photo/graphic mix. Refresh once and regenerate before launching.",
      });
    }
  }

  try {
    await mongooseConnect();
    const launchValidation = await validateLaunchInput({
      userEmail: session.user.email,
      body: req.body,
    });
    normalizedLicensedStates = launchValidation.licensedStates;
    const lockedStructure = launchValidation.structure;

    const userEmail = String(session.user.email).toLowerCase();
    const user = await User.findOne({ email: userEmail })
      .select("_id email name firstName lastName agentPhone numbers metaAccessToken metaSystemUserToken metaPageAccessToken metaAdAccountId metaPageId metaPageName metaInstagramId metaDatasetId")
      .lean();
    if (!user) {
      return res.status(404).json({ error: "User account not found" });
    }
    const resolvedPageId = String(
      launchValidation.pageId ||
      facebookPageId ||
      (user as any).metaPageId ||
      ""
    ).trim();
    const resolvedAdAccountId = String(
      launchValidation.adAccountId ||
      adAccountId ||
      (user as any).metaAdAccountId ||
      ""
    ).trim().replace(/^act_/, "");
    const resolvedPageName =
      resolvedPageId && resolvedPageId === String((user as any).metaPageId || "").trim()
          ? String((user as any).metaPageName || "").trim()
          : "";
    const agentContact = injectAgentContact(user, {
      name: publicAgentProfile?.displayName,
      phone: publicAgentProfile?.phone,
      email: (user as any).email,
    });
    // CoveCRM owns and hosts the lead experience. Do not make agents complete a
    // second advertising profile before they can publish: prefer their optional
    // profile, then the connected Meta Page identity, then a neutral label.
    const advertiserBusinessName = String(
      publicAgentProfile?.businessName || resolvedPageName || agentContact.name || "Independent Insurance Agent"
    ).trim();
    const advertiserDisplayName = String(
      agentContact.name || resolvedPageName || advertiserBusinessName || "Licensed Insurance Agent"
    ).trim();
    const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://www.covecrm.com").replace(/\/$/, "");
    const resolvedPrivacyUrl = String(complianceProfile?.privacyUrl || `${appUrl}/legal/privacy`).trim();
    const resolvedTermsUrl = String(complianceProfile?.termsUrl || `${appUrl}/legal/terms`).trim();

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
      throw new Error("No rendered creative image provided. CSS renderer must supply renderedCreativeDataUrl.");
    }

    if (!resolvedImageUrl) {
      return res.status(400).json({
        ok: false,
        error: "Image generation required before publish",
      });
    }

    const storedDrafts = normalizedDrafts.map(stripRenderedCreativeData);
    const storedImageUrl = String(imageUrl || normalizedDrafts[0]?.imageUrl || "").trim();
    const launchFingerprint = buildLaunchFingerprint({
      adAccountId: resolvedAdAccountId,
      pageId: resolvedPageId,
      leadType,
      audienceSegment,
      targetingPolicyVersion: lockedStructure.targetingProfile.policyVersion,
      campaignType,
      licensedStates: normalizedLicensedStates,
      dailyBudgetCents: budgetCents,
      funnelType,
      performanceGoal,
      nativeFormSchemaVersion: campaignType === "native_form" ? "insurance-native-v1" : "",
      creatives: normalizedDrafts,
    });

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
      qualifierTexts: [] as string[],
    };

    // Copy review is advisory only. Qualifiers are still derived from recognized
    // claims and rendered on the hosted funnel, but CoveCRM never blocks publish.
    // Keep automatic disclosures and the immutable audit archive, but do not
    // make publishing depend on CoveCRM-maintained approval records. Meta is the
    // final authority for ad review.
    const registeredClaims = DEFAULT_META_CLAIMS as any[];
    const creativeClaimText = normalizedDrafts.map((draft) => [
      draft?.primaryText,
      draft?.headline,
      draft?.description,
    ].map(String).join("\n")).join("\n");
    funnelData.qualifierTexts = requiredQualifierTextsForCreative(creativeClaimText, registeredClaims as any);
    const baseDisclaimerCore = String(complianceProfile?.disclaimerText || "").trim() ||
      "Availability varies by state and carrier. This is a no-obligation review with a licensed insurance agent. Products, rates, and eligibility are subject to carrier underwriting and policy terms.";
    const governmentDisclaimer = audienceSegment === "veteran" || leadType === "veteran"
      ? "This is not affiliated with or endorsed by the U.S. Department of Veterans Affairs, the U.S. military, or any government agency."
      : "";
    const baseDisclaimer = [baseDisclaimerCore, governmentDisclaimer].filter(Boolean).join(" ");
    const landingPageSnapshot = buildLandingPageSnapshot({
      ...funnelData,
      disclaimerText: baseDisclaimer,
    });
    const claimEvaluation = evaluateCreativeClaims({
      creativeText: creativeClaimText,
      leadType: String(leadType),
      states: normalizedLicensedStates,
      landingPageSnapshot,
      claims: registeredClaims as any,
    });

    // 1. Ensure CRM folder exists — convention: "FB: {campaignName}"
    //    This matches what the webhook uses for lead routing.
    const folderName = `FB: ${safeName}`;
    let folder: any = null;
    let folderError: string | null = null;
    try {
      folder = await Folder.findOne({ userEmail, name: folderName }).lean();
      if (!folder) {
        const aiScriptKey =
          (leadType === "mortgage_protection" && audienceSegment === "veteran") ? "veteran_mortgage" :
          (leadType === "iul"                 && audienceSegment === "veteran") ? "veteran_iul" :
          (leadType === "mortgage_protection" && audienceSegment === "trucker") ? "trucker_mortgage" :
          (leadType === "iul"                 && audienceSegment === "trucker") ? "trucker_iul" :
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

    // 2. Atomically claim the exact canonical launch. Display names are cosmetic and
    //    deliberately excluded from idempotency so same-name launches cannot collide.
    const { campaign, launchClaimToken } = await claimLaunchCampaign({
      campaignModel: FBLeadCampaign,
      userEmail,
      launchFingerprint,
      setOnInsert: {
          userId: (user as any)._id,
          status: "setup",
          plan: "manager",
      },
      set: {
          campaignName: safeName,
          leadType,
          audienceSegment,
          targetingProfileKey: lockedStructure.targetingProfile.key,
          targetingPolicyVersion: lockedStructure.targetingProfile.policyVersion,
          targetingQualificationMode: lockedStructure.targetingProfile.qualificationMode,
          campaignType,
          performanceGoal: performanceGoal === "QUALITY_LEAD" ? "QUALITY_LEAD" : "LEAD_GENERATION",
          nativeFormConfiguration: campaignType === "native_form" ? {
            schemaVersion: "insurance-native-v1",
            formMode: "HIGHER_INTENT",
            flexibleDelivery: false,
            smsVerification: true,
          } : {
            schemaVersion: "",
            formMode: "",
            flexibleDelivery: false,
            smsVerification: false,
          },
          attributionVersion: "signed-v1",
          dailyBudget: budgetCents / 100,
          folderId,
          facebookPageId: resolvedPageId,
          facebookPageName: resolvedPageName,
          adAccountId: resolvedAdAccountId,
          funnelStatus: campaignType === "native_form" ? "paused" : "active",
          funnelSlug,
          funnelVersion: "2026-04-production-v1",
          landingPageConfig: funnelData,
          licensedStates: normalizedLicensedStates,
          borderStateBehavior: borderStateBehavior === "allow_with_warning" ? "allow_with_warning" : "block",
          stateRestrictionNoticeAccepted: true,
          publicAgentProfile: {
            displayName: advertiserDisplayName,
            businessName: advertiserBusinessName,
            phone: agentContact.phone,
            stateLabel: normalizedLicensedStates.join(", "),
            logoUrl: String(publicAgentProfile?.logoUrl || "").trim(),
            headshotUrl: String(publicAgentProfile?.headshotUrl || "").trim(),
          },
          complianceProfile: {
            disclaimerText:
              baseDisclaimer,
            consentText:
              String(complianceProfile?.consentText || "").trim() ||
              "By submitting, you agree to be contacted by phone, text/SMS, or email by a licensed insurance agent, including through automated systems, artificial or prerecorded voice, and AI-assisted or virtual assistant calls. Reply STOP to opt out of texts. Consent is not a condition of purchase.",
            privacyUrl: resolvedPrivacyUrl,
            termsUrl: resolvedTermsUrl,
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
    });

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
      creativeFamily: string;
      destinationUrl: string;
      status: string;
    }> = [];
    let metaPublishStatus: "not_attempted" | "skipped_missing_meta_connection" | "success" | "failed" = "not_attempted";
    let metaError: string | null = null;
    let creativeClaimToken = "";
    let creativeReservations: CreativeReservation[] = [];

    try {
      const fullUser = user as any;
      const accessToken = String(launchValidation.accessToken || "").trim();
      const adAccountIdFinal = resolvedAdAccountId;
      const pageIdFinal = resolvedPageId;
      const instagramId = String(fullUser?.metaInstagramId || "").trim();
      metaCampaignId = String((campaign as any).metaCampaignId || "").trim();
      metaAdsetId = String((campaign as any).metaAdsetId || "").trim();
      metaFormId = String((campaign as any).metaFormId || "").trim();
      metaAdId = String((campaign as any).metaAdId || "").trim();

      const isAlreadyPublished = campaignType === "native_form"
        ? !!(metaCampaignId && metaAdsetId && metaFormId && metaAdId)
        : !!(metaCampaignId && metaAdsetId && metaAdId);

      const metaHealth = await checkMetaWriteReadiness({
        user: fullUser,
        userEmail,
        accessToken,
        pageId: pageIdFinal,
        adAccountId: adAccountIdFinal,
        requireLeadAdsEligibility: campaignType === "native_form",
        force: true,
      });
      if (!metaHealth.ok) {
        await FBLeadCampaign.updateOne(
          { _id: campaign._id, userEmail },
          {
            $set: {
              metaPublishStatus: "failed",
              metaPublishError: metaHealth.reason,
              metaLastPublishAttemptAt: new Date(),
              metaObjectHealth: metaHealth.status === "reconnectNeeded" ? "token_expired" : "sync_failed",
            },
          }
        ).catch(() => {});
        await releaseLaunchCampaignClaim({
          campaignModel: FBLeadCampaign,
          campaignId: campaign._id,
          userEmail,
          launchClaimToken,
        }).catch(() => {});
        return res.status(400).json({
          ok: false,
          error: metaHealth.reason,
          metaHealth,
        });
      }

      if (!isAlreadyPublished) {
        const creativeClaim = await claimCreativeSet({
          userEmail,
          campaignId: campaign._id,
          leadType: String(leadType),
          drafts: normalizedDrafts,
        });
        creativeClaimToken = creativeClaim.claimToken;
        creativeReservations = creativeClaim.reservations;
      }

      if (!metaCampaignId) {
        const campaignParams = new URLSearchParams();
        campaignParams.set("name", lockedStructure.campaign.name);
        campaignParams.set("objective", lockedStructure.campaign.objective);
        campaignParams.set("buying_type", lockedStructure.campaign.buying_type);
        campaignParams.set("status", lockedStructure.campaign.status);
        campaignParams.set("special_ad_categories", JSON.stringify(lockedStructure.campaign.special_ad_categories));
        campaignParams.set("special_ad_category_countries", JSON.stringify(["US"]));
        campaignParams.set("is_adset_budget_sharing_enabled", "false");
        campaignParams.set("access_token", accessToken);

        const metaCampaignResp = await fetch(metaGraphUrl(`act_${adAccountIdFinal}/campaigns`), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: campaignParams.toString(),
        });
        const metaCampaignJson = await metaCampaignResp.json();

        if (!metaCampaignResp.ok || !metaCampaignJson?.id) {
          throw new Error(`Meta campaign create failed: ${JSON.stringify(metaCampaignJson)}`);
        }
        metaCampaignId = String(metaCampaignJson.id);
        await FBLeadCampaign.findOneAndUpdate(
          { _id: campaign._id, userEmail },
          { $set: { metaCampaignId, facebookCampaignId: metaCampaignId, metaLastPublishAttemptAt: new Date() } }
        );
      }

      if (!metaAdsetId) {
        const adsetParams = new URLSearchParams();
        adsetParams.set("name", lockedStructure.adSet.name);
        adsetParams.set("campaign_id", metaCampaignId);
        adsetParams.set("daily_budget", String(lockedStructure.adSet.daily_budget));
        adsetParams.set("billing_event", lockedStructure.adSet.billing_event);
        adsetParams.set("optimization_goal", lockedStructure.adSet.optimization_goal);
        adsetParams.set("bid_strategy", lockedStructure.adSet.bid_strategy);
        adsetParams.set("status", lockedStructure.adSet.status);
        adsetParams.set("promoted_object", JSON.stringify({ page_id: pageIdFinal }));
        adsetParams.set("targeting", JSON.stringify(lockedStructure.adSet.targeting));
        adsetParams.set("destination_type", campaignType === "native_form" ? "ON_AD" : "WEBSITE");
        adsetParams.set("access_token", accessToken);

        const metaAdsetResp = await fetch(metaGraphUrl(`act_${adAccountIdFinal}/adsets`), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: adsetParams.toString(),
        });
        const metaAdsetJson = await metaAdsetResp.json();

        if (!metaAdsetResp.ok || !metaAdsetJson?.id) {
          throw new Error(`Meta ad set create failed: ${JSON.stringify(metaAdsetJson)}`);
        }
        metaAdsetId = String(metaAdsetJson.id);
        await FBLeadCampaign.findOneAndUpdate(
          { _id: campaign._id, userEmail },
          { $set: { metaAdsetId, metaLastPublishAttemptAt: new Date() } }
        );
      }

      await verifyMetaAdset({
        metaAdsetId,
        accessToken,
        expectedDailyBudgetCents: lockedStructure.adSet.daily_budget,
        expectedTargeting: lockedStructure.adSet.targeting,
      });

      if (isAlreadyPublished) {
        await releaseLaunchCampaignClaim({
          campaignModel: FBLeadCampaign,
          campaignId: campaign._id,
          userEmail,
          launchClaimToken,
        });
        return res.status(200).json({
          ok: true,
          alreadyPublished: true,
          verifiedMetaAdset: true,
          message: "Exact launch already exists and its live Meta ad set matches the requested budget and regions.",
          campaignId: String(campaign._id),
          folderId: String(folderId),
          folderName,
          campaignName: safeName,
          leadType,
          metaCampaignId,
          metaAdsetId,
          metaFormId,
          metaAdId,
          ads: Array.isArray((campaign as any).ads) ? (campaign as any).ads : [],
          adCount: Array.isArray((campaign as any).ads) ? (campaign as any).ads.length : 1,
        });
      }

      if (campaignType !== "hosted_funnel" && campaignType !== "hosted_funnel_otp") {
      if (!metaFormId) {
        const leadSpecificQ = getLeadSpecificQuestion(leadType, audienceSegment);
        const questions: Array<Record<string, any>> = [
          { type: "FULL_NAME" },
          { type: "CUSTOM", label: leadSpecificQ.label, key: leadSpecificQ.key },
          { type: "PHONE" },
          { type: "EMAIL" },
          { type: "CUSTOM", label: audienceSegment === "spanish" ? "Edad" : "Age", key: "age" },
          { type: "CUSTOM", label: audienceSegment === "spanish" ? "Estado" : "State", key: "state" },
        ];

        const storedComplianceProfile = (campaign as any).complianceProfile || {};
        const storedDisclaimerText = String(
          storedComplianceProfile.disclaimerText ||
          complianceProfile?.disclaimerText ||
          (audienceSegment === "spanish"
            ? "La disponibilidad varía según el estado y la compañía. Esta es una revisión sin obligación con un agente autorizado."
            : "Availability varies by state and carrier. This is a no-obligation review with a licensed agent.")
        ).trim() + (funnelData.qualifierTexts.length ? `\n${funnelData.qualifierTexts.join("\n")}` : "");
        const storedConsentText = String(
          storedComplianceProfile.consentText ||
          complianceProfile?.consentText ||
          (audienceSegment === "spanish"
            ? "Al enviar este formulario, acepta que un agente autorizado se comunique con usted por teléfono, SMS o correo electrónico, incluso mediante sistemas automatizados, voz artificial o pregrabada y llamadas asistidas por IA o asistentes virtuales. Responda STOP para dejar de recibir mensajes. El consentimiento no es una condición de compra."
            : "By submitting, you agree to be contacted by phone, text/SMS, or email by a licensed insurance agent, including through automated systems, artificial or prerecorded voice, and AI-assisted or virtual assistant calls. Reply STOP to opt out of texts. Consent is not a condition of purchase.")
        ).trim();
        const privacyUrl = String(
          storedComplianceProfile.privacyUrl ||
          complianceProfile?.privacyUrl ||
          resolvedPrivacyUrl
        ).trim();
        // Meta Instant Forms support privacy_policy and custom_disclaimer.
        // There is no separate supported termsUrl field here, so termsUrl stays stored internally on FBLeadCampaign.
        const customDisclaimer = {
          title: "Consent and Important Disclosures",
          body: {
            text: storedDisclaimerText,
          },
          checkboxes: [
            {
              is_required: true,
              is_checked_by_default: false,
              key: "covecrm_contact_consent",
              text: storedConsentText,
            },
          ],
        };

        const formName = `${safeName} Insurance Lead Form`;
        const followUpActionUrl = `${appUrl}/insurance-request-received`;
        const nativeFormSpecification: NativeLeadFormSpecification = {
          schemaVersion: "insurance-native-v1",
          leadType: String(leadType),
          audienceSegment,
          questions,
          privacyPolicy: { url: privacyUrl || "https://www.covecrm.com/legal/privacy", link_text: "Privacy Policy" },
          customDisclaimer,
          followUpActionUrl,
          formMode: "HIGHER_INTENT",
          flexibleDelivery: false,
          smsVerification: true,
        };
        const formClaim = await claimNativeLeadFormTemplate({
          userEmail,
          pageId: pageIdFinal,
          formName,
          specification: nativeFormSpecification,
        });
        if (formClaim.reused) {
          metaFormId = formClaim.formId;
          const pageAccessToken = String((user as any)?.metaPageAccessToken || "").trim();
          await verifyNativeLeadFormQualitySettings({
            formId: metaFormId,
            accessToken: pageAccessToken || accessToken,
            formUrl: (formId) => metaGraphUrl(formId),
          });
          await FBLeadCampaign.findOneAndUpdate(
            { _id: campaign._id, userEmail },
            { $set: { metaFormId, metaFormFingerprint: formClaim.fingerprint, metaLastPublishAttemptAt: new Date() } }
          );
        } else {
        const metaFormParams = new URLSearchParams();
        metaFormParams.set("name", formName);
        metaFormParams.set("locale", "en_US");
        metaFormParams.set("privacy_policy", JSON.stringify(nativeFormSpecification.privacyPolicy));
        metaFormParams.set("custom_disclaimer", JSON.stringify(customDisclaimer));
        metaFormParams.set("follow_up_action_url", followUpActionUrl);
        metaFormParams.set("questions", JSON.stringify(questions));
        metaFormParams.set("is_optimized_for_quality", "true");
        metaFormParams.set("is_phone_sms_verify_enabled", "true");
        // Prefer page access token for page-scoped leadgen_forms endpoint
        const pageAccessToken = String((user as any)?.metaPageAccessToken || "").trim();
        metaFormParams.set("access_token", pageAccessToken || accessToken);

        const metaFormResp = await fetch(metaGraphUrl(`${pageIdFinal}/leadgen_forms`), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: metaFormParams.toString(),
        });
        const metaFormJson = await metaFormResp.json();

        if (!metaFormResp.ok || !metaFormJson?.id) {
          const formError = new Error(`Meta lead form create failed: ${JSON.stringify(metaFormJson)}`);
          await failNativeLeadFormTemplate({
            userEmail,
            pageId: pageIdFinal,
            fingerprint: formClaim.fingerprint,
            claimToken: formClaim.claimToken,
            error: formError,
          }).catch(() => {});
          throw formError;
        }
        metaFormId = String(metaFormJson.id);
        try {
          await verifyNativeLeadFormQualitySettings({
            formId: metaFormId,
            accessToken: pageAccessToken || accessToken,
            formUrl: (formId) => metaGraphUrl(formId),
          });
        } catch (verificationError) {
          await failNativeLeadFormTemplate({
            userEmail,
            pageId: pageIdFinal,
            fingerprint: formClaim.fingerprint,
            claimToken: formClaim.claimToken,
            error: verificationError,
          }).catch(() => {});
          throw verificationError;
        }
        await finalizeNativeLeadFormTemplate({
          userEmail,
          pageId: pageIdFinal,
          fingerprint: formClaim.fingerprint,
          claimToken: formClaim.claimToken,
          formId: metaFormId,
        });
        await FBLeadCampaign.findOneAndUpdate(
          { _id: campaign._id, userEmail },
          { $set: { metaFormId, metaFormFingerprint: formClaim.fingerprint, metaLastPublishAttemptAt: new Date() } }
        );
        }
      }
      } // end native_form-only block
        const instantFormDisplayUrl = appUrl || "https://www.covecrm.com";
        const funnelUrl = `${appUrl}/f/${String((campaign as any)._id)}`;
        publishedAds = [];

        for (let index = 0; index < normalizedDrafts.length; index++) {
          const currentDraft = normalizedDrafts[index] || {};
          const variantId = String(currentDraft.uniquenessFingerprint || `variant_${index + 1}`);
          const creativeFamily = String(currentDraft.winningFamilyId || currentDraft.creativeArchetype || "");
          let currentImageUrl = String(
            currentDraft.renderedCreativeDataUrl ||
            currentDraft.imageUrl ||
            ""
          ).trim();
          if (!currentImageUrl) {
            throw new Error("No rendered creative image for ad " + index + ". CSS renderer must supply renderedCreativeDataUrl.");
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

          const attributionToken = campaignType === "native_form"
            ? ""
            : signHostedAttributionToken({
                campaignId: String((campaign as any)._id),
                variantId,
                creativeFamily,
              });
          const trackedFunnelUrl = new URL(funnelUrl);
          if (attributionToken) trackedFunnelUrl.searchParams.set("cat", attributionToken);
          trackedFunnelUrl.searchParams.set("utm_source", "meta");
          trackedFunnelUrl.searchParams.set("utm_medium", "paid_social");
          trackedFunnelUrl.searchParams.set("utm_campaign", String((campaign as any)._id));
          trackedFunnelUrl.searchParams.set("utm_content", variantId);
          const resolvedAdLink = campaignType === "native_form" ? instantFormDisplayUrl : trackedFunnelUrl.toString();
          const objectStorySpec: Record<string, any> = {
            page_id: pageIdFinal,
            link_data: {
              link: resolvedAdLink,
              message: String(currentDraft.primaryText || primaryText || ""),
              name: String(currentDraft.headline || headline || ""),
              description: String(currentDraft.description || description || ""),
              call_to_action: {
                type: (() => {
                  const raw = String(currentDraft.cta || cta || "LEARN_MORE").toUpperCase();
                  const CTA_MAP: Record<string, string> = {
                    "LEARN MORE": "LEARN_MORE",
                    "APPLY NOW": "APPLY_NOW",
                    "GET QUOTE": "GET_QUOTE",
                    "SIGN UP": "SIGN_UP",
                    "GET STARTED": "GET_STARTED",
                    "CONTACT US": "CONTACT_US",
                    "SUBSCRIBE": "SUBSCRIBE",
                  };
                  if (Object.values(CTA_MAP).includes(raw)) return raw;
                  for (const [k, v] of Object.entries(CTA_MAP)) {
                    if (raw.includes(k.replace("_", " "))) return v;
                  }
                  return "LEARN_MORE";
                })(),
                value: campaignType === "native_form"
                  ? { lead_gen_form_id: metaFormId }
                  : { link: resolvedAdLink },
              },
            },
          };

          if (resolvedMetaImageHash) {
            objectStorySpec.link_data.image_hash = resolvedMetaImageHash;
          } else {
            objectStorySpec.link_data.image_url = currentImageUrl;
          }
          // instagram_actor_id removed — only add when a verified IG account ID is stored

          const creativeParams = new URLSearchParams();
          creativeParams.set("name", `${safeName} Creative ${index + 1}`);
          creativeParams.set("object_story_spec", JSON.stringify(objectStorySpec));
          creativeParams.set(
            "degrees_of_freedom_spec",
            JSON.stringify(buildMetaCreativeEnhancementSpec())
          );
          creativeParams.set("access_token", accessToken);

          const metaCreativeResp = await fetch(metaGraphUrl(`act_${adAccountIdFinal}/adcreatives`), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: creativeParams.toString(),
          });
          const metaCreativeJson = await metaCreativeResp.json();

          if (!metaCreativeResp.ok || !metaCreativeJson?.id) {
            throw new Error(`Meta creative create failed: ${JSON.stringify(metaCreativeJson)}`);
          }
          const creativeId = String(metaCreativeJson.id);

          // Once Meta has accepted the creative object, permanently consume
          // this design even if a later ad-object request fails. Reusing it
          // after a partial Meta publish would violate the global guarantee.
          await finalizeCreativeReservation({
            claimToken: creativeClaimToken,
            creativeFingerprint: creativeReservations[index]?.creativeFingerprint || "",
            metaAdId: "",
            metaCreativeId: creativeId,
          });

          const adParams = new URLSearchParams();
          adParams.set("name", `${safeName} Ad ${index + 1}`);
          adParams.set("adset_id", metaAdsetId);
          adParams.set("creative", JSON.stringify({ creative_id: creativeId }));
          adParams.set("status", "PAUSED");
          adParams.set("access_token", accessToken);

          const metaAdResp = await fetch(metaGraphUrl(`act_${adAccountIdFinal}/ads`), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: adParams.toString(),
          });
          const metaAdJson = await metaAdResp.json();

          if (!metaAdResp.ok || !metaAdJson?.id) {
            throw new Error(`Meta ad create failed: ${JSON.stringify(metaAdJson)}`);
          }

          const createdMetaAdId = String(metaAdJson.id);
          if (!metaAdId) {
            metaAdId = createdMetaAdId;
            await FBLeadCampaign.findOneAndUpdate(
              { _id: campaign._id, userEmail },
              { $set: { metaAdId, metaLastPublishAttemptAt: new Date() } }
            );
          }
          publishedAds.push({
            variantId,
            variationType: String(currentDraft.variationType || ""),
            headline: String(currentDraft.headline || headline || ""),
            imageUrl: String(currentDraft.imageUrl || ""),
            metaAdId: createdMetaAdId,
            metaCreativeId: creativeId,
            creativeFamily,
            destinationUrl: resolvedAdLink,
            status: "PAUSED",
          });
        }

        const now = new Date();
        await writeImmutableMetaLaunchArchive({
              userEmail,
              campaignId: campaign._id,
              launchFingerprint,
              leadType,
              audienceSegment,
              targetingProfile: lockedStructure.targetingProfile,
              licensedStates: normalizedLicensedStates,
              adCopy: normalizedDrafts.map((draft) => ({
                primaryText: String(draft?.primaryText || ""),
                headline: String(draft?.headline || ""),
                description: String(draft?.description || ""),
                cta: String(draft?.cta || ""),
                variantId: String(draft?.uniquenessFingerprint || ""),
                creativeFamily: String(draft?.winningFamilyId || draft?.creativeArchetype || ""),
              })),
              images: normalizedDrafts.map((draft, index) => ({
                variantId: String(draft?.uniquenessFingerprint || `variant_${index + 1}`),
                dataUrl: String(draft?.renderedCreativeDataUrl || draft?.imageUrl || ""),
              })),
              landingPageSnapshot,
              qualifierTexts: funnelData.qualifierTexts,
              claims: claimEvaluation.matchedClaims.map((claim: any) => ({
                claimText: claim.claimText,
                classification: claim.classification,
                version: claim.version,
                approvedBy: claim.approvedBy,
              })),
              destinationUrls: publishedAds.map((ad) => ad.destinationUrl),
              metaObjectIds: {
                campaignId: metaCampaignId,
                adsetId: metaAdsetId,
                formId: metaFormId,
                ads: publishedAds.map((ad) => ({ adId: ad.metaAdId, creativeId: ad.metaCreativeId })),
              },
              archivedAt: now,
        });
        const finalizedCampaign = await FBLeadCampaign.findOneAndUpdate(
          { _id: campaign._id, userEmail, launchClaimToken },
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
              launchClaimToken: "",
              launchClaimedAt: null,
            },
          },
          { new: true }
        );
        if (!finalizedCampaign) throw new Error("Launch claim was lost before Meta publish finalization");

        metaPublishStatus = "success";
    } catch (err: any) {
      metaPublishStatus = "failed";
      metaError = err?.message || "Meta publish failed";
      await releaseCreativeSet(creativeClaimToken).catch(() => {});
      await markMetaHealthFailure({
        user,
        userEmail,
        error: metaError,
      }).catch(() => {});
      console.error("[publish-ad] meta publish error:", metaError);
    }

    // Persist publish diagnostics for non-success outcomes
    if (metaPublishStatus !== "success") {
      await FBLeadCampaign.updateOne(
        { _id: campaign._id, userEmail },
        {
          $set: {
            metaPublishStatus,
            metaPublishError: metaError || "",
            metaLastPublishAttemptAt: new Date(),
            metaObjectHealth: "sync_failed",
            launchClaimToken: "",
            launchClaimedAt: null,
          },
        }
      ).catch((e: any) => console.warn("[publish-ad] diagnostics update failed:", e?.message));
    }

    const campaignId = String(campaign._id);

    if (metaPublishStatus === "failed") {
      return res.status(500).json({
        ok: false,
        // Raw Meta payloads stay in server logs and campaign diagnostics. They
        // must never be rendered in the customer-facing launch flow.
        error: getMetaLaunchPublicMessage(metaError),
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
    return res.status(500).json({
      ok: false,
      error: getMetaLaunchPublicMessage(err?.message),
    });
  }
}
