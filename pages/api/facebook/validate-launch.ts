import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { buildCampaignStructure } from "@/lib/facebook/buildCampaignStructure";
import { validateStates } from "@/lib/facebook/guardrails";
import { validateWinningVariantMetadata } from "@/lib/facebook/winningAdLibrary";
import { requireDailyBudgetCents } from "@/lib/facebook/launchFingerprint";
import { hasRecentMetaQualitySignal, isCapiEnabled } from "@/lib/meta/capi";
import { assertNativeFormComplianceMode } from "@/lib/facebook/metaLeadFormTemplate";
import {
  assertAllAudienceCreativeMatches,
  resolveAudienceSegment,
  type MetaLeadType,
} from "@/lib/facebook/audienceTargeting";

const VALID_LEAD_TYPES = [
  "final_expense",
  "iul",
  "mortgage_protection",
  "veteran",
  "trucker",
];

export async function validateLaunchInput(params: {
  userEmail: string;
  body: any;
}) {
  await mongooseConnect();

  const body = params.body || {};
  const user = await User.findOne({ email: String(params.userEmail).toLowerCase() })
    .select("_id metaAccessToken metaSystemUserToken metaAdAccountId metaPageId metaDatasetId metaCapiAdAccountId metaCapiEnabled")
    .lean() as any;

  if (!user) throw new Error("User account not found");

  const accessToken = String(user.metaSystemUserToken || user.metaAccessToken || "").trim();
  const leadType = String(body.leadType || "").trim();
  const audienceSegment = resolveAudienceSegment({
    leadType,
    audienceSegment: body.audienceSegment,
  });
  const adAccountId = String(
    body.adAccountId ||
      user.metaAdAccountId ||
      ""
  ).trim();
  const pageId = String(
    body.facebookPageId ||
      user.metaPageId ||
      ""
  ).trim();

  if (!accessToken || !adAccountId) throw new Error("Ad account connection required");
  if (!pageId) throw new Error("Facebook page connection required");
  const campaignType = String(body.campaignType || "hosted_funnel");
  if (campaignType === "native_form") assertNativeFormComplianceMode();
  const datasetId = String(user.metaDatasetId || "").trim();
  if (campaignType !== "native_form" && !datasetId) {
    throw new Error("Website lead campaigns require a connected Meta Pixel/dataset and standard Lead conversion event");
  }

  if (!VALID_LEAD_TYPES.includes(leadType)) throw new Error("Lead type required");
  const performanceGoal = body.performanceGoal === "QUALITY_LEAD" ? "QUALITY_LEAD" : "LEAD_GENERATION";
  if (performanceGoal === "QUALITY_LEAD" && (
    !String(user.metaDatasetId || "").trim() ||
    String(user.metaCapiAdAccountId || "").replace(/^act_/, "") !== adAccountId.replace(/^act_/, "") ||
    !user.metaCapiEnabled ||
    !isCapiEnabled()
  )) {
    throw new Error("Conversion leads optimization requires an enabled CoveCRM CAPI dataset connected to the selected ad account");
  }
  if (performanceGoal === "QUALITY_LEAD" && !(await hasRecentMetaQualitySignal(params.userEmail))) {
    throw new Error("Conversion leads optimization requires a successful qualified CRM event in Meta within the last 30 days");
  }

  const licensedStates = validateStates(body.licensedStates);
  const winningFamily = validateWinningVariantMetadata({
    leadType,
    winningFamilyId: body.winningFamilyId,
    variationType: body.variationType,
    uniquenessFingerprint: body.uniquenessFingerprint,
    vendorStyleTag: body.vendorStyleTag,
  });

  if (!body.funnelType && !body.landingPageConfig && !body.winnerLandingPageConfig) {
    throw new Error("Funnel required");
  }

  const landingPageText = JSON.stringify(body.landingPageConfig || body.winnerLandingPageConfig || {});
  const creativesToValidate = Array.isArray(body.drafts) && body.drafts.length
    ? body.drafts
    : [{
        primaryText: body.primaryText,
        headline: body.headline,
        description: body.description,
        cta: body.cta,
        imageUrl: body.imageUrl,
        imagePrompt: body.imagePrompt,
        templateId: body.winningFamilyId,
      }];
  assertAllAudienceCreativeMatches({
    leadType,
    audienceSegment,
    creatives: creativesToValidate,
    landingPageText,
  });

  const structure = buildCampaignStructure({
    campaignName: body.campaignName,
    leadType: leadType as MetaLeadType,
    licensedStates,
    dailyBudgetCents: requireDailyBudgetCents(body.dailyBudgetCents),
    audienceSegment,
    mortgageTargetingVariant: body.mortgageTargetingVariant,
    performanceGoal,
    campaignType: campaignType === "native_form" || campaignType === "hosted_funnel_otp"
      ? campaignType
      : "hosted_funnel",
    creatives: creativesToValidate.map((creative: any) => ({
      primaryText: creative?.primaryText,
      headline: creative?.headline,
      description: creative?.description,
      cta: creative?.cta,
      imageUrl: creative?.imageUrl,
      imagePrompt: creative?.imagePrompt,
      templateId: creative?.templateId || creative?.winningFamilyId || winningFamily.id,
    })),
  });

  if (!structure.campaign?.objective || !structure.adSet?.targeting?.geo_locations || !structure.ads.length) {
    throw new Error("Invalid campaign structure");
  }

  return {
    ok: true,
    user,
    accessToken,
    adAccountId: adAccountId.replace(/^act_/, ""),
    pageId,
    datasetId,
    licensedStates,
    audienceSegment,
    structure,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await validateLaunchInput({
      userEmail: session.user.email,
      body: req.body,
    });
    return res.status(200).json({
      ok: true,
      licensedStates: result.licensedStates,
      structure: result.structure,
    });
  } catch (err: any) {
    return res.status(400).json({ ok: false, error: err?.message || "Launch validation failed" });
  }
}
