import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import {
  type AudienceSegment,
  buildWinningFunnelConfig,
  generateWinningVariantList,
  generateWinningVariants,
  isWinnerSupportedLeadType,
  selectRecommendedVariant,
} from "@/lib/facebook/winningAdLibrary";

const LEAD_FORM_QUESTIONS = {
  mortgage_protection: [
    "Full Name",
    "Phone Number",
    "Email Address",
    "Mortgage Balance (approximate)",
    "Birth Year",
    "Are you a smoker? (Yes / No)",
  ],
  final_expense: [
    "Full Name",
    "Phone Number",
    "Email Address",
    "Age Range (45-54 / 55-64 / 65-75 / 76-85)",
    "State",
    "Coverage Amount Wanted ($5,000-$25,000 / $25,000+)",
  ],
  veteran: [
    "Full Name",
    "Phone Number",
    "Email Address",
    "Are you a Veteran, Spouse, or Dependent?",
    "Age Range (30-49 / 50-65 / 66-79 / 80+)",
    "State",
  ],
  trucker: [
    "Full Name",
    "Phone Number",
    "Email Address",
    "CDL Driver? (Yes / No)",
    "Age Range (35-44 / 45-54 / 55-64 / 65+)",
    "State",
  ],
  iul: [
    "Full Name",
    "Phone Number",
    "Email Address",
    "Age",
    "State",
    "Primary Interest (Protection / Cash Value / Retirement / Legacy)",
    "Current Coverage Amount",
  ],
} as const;

const THANK_YOU_TEXT = {
  mortgage_protection:
    "Thank you! One of our licensed agents will reach out shortly to review your mortgage protection options. No obligation - just a quick conversation.",
  final_expense:
    "Thank you! A licensed agent will contact you soon to go over coverage options. This is a no-obligation review.",
  veteran:
    "Thank you for your interest. A licensed agent will reach out to review private coverage options available to you and your family.",
  trucker:
    "Thank you! A licensed agent will reach out shortly to review coverage options designed for CDL drivers.",
  iul:
    "Thank you! A licensed professional will reach out soon to review IUL education and options. This is a no-obligation educational review.",
} as const;

function normalizeAudienceSegment(segment?: string): AudienceSegment {
  return segment === "veteran" || segment === "trucker" ? segment : "standard";
}

function campaignLabel(leadType: string) {
  return leadType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, source: "winner_library" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    leadType = "mortgage_protection",
    location: locationParam = "",
    agentState = "",
    dailyBudget = 25,
    audienceSegment: audienceSegmentParam = "standard",
  } = req.body as {
    leadType?: string;
    location?: string;
    agentState?: string;
    dailyBudget?: number;
    audienceSegment?: string;
    variantCount?: number;
  };

  if (!isWinnerSupportedLeadType(leadType)) {
    return res.status(400).json({
      ok: false,
      error: "This lead type is not available in the winning ad library.",
    });
  }

  const userEmail = String(session.user.email).toLowerCase();
  const location = String(locationParam || agentState || "").trim();
  const audienceSegment = normalizeAudienceSegment(audienceSegmentParam);
  const requestedVariantCount = Math.min(4, Math.max(1, Number((req.body as any)?.variantCount) || 3));
  const campaignName = location
    ? `${campaignLabel(leadType)} - ${location}`
    : `${campaignLabel(leadType)} Campaign`;

  const variants = generateWinningVariants({
    leadType,
    audienceSegment,
    userId: userEmail,
    campaignName,
    location,
  });
  const selectedVariant = selectRecommendedVariant(leadType, variants);
  const selectedVariants = generateWinningVariantList({
    leadType,
    audienceSegment,
    userId: userEmail,
    campaignName,
    location,
    variantCount: requestedVariantCount,
  });
  const dailyBudgetCents = Math.round((Number(dailyBudget) || 25) * 100);
  const buildDraftFromVariant = (variant: typeof variants.emotional) => ({
    leadType,
    audienceSegment,
    campaignName,
    dailyBudgetCents,
    primaryText: variant.primaryText,
    headline: variant.headline,
    description: variant.description,
    cta: variant.cta,
    imagePrompt: variant.imagePrompt,
    videoScript: variant.videoScript,
    buttonLabels: variant.buttonLabels,
    bulletPoints: variant.bulletPoints,
    creativeArchetype: variant.archetype,
    landingPageConfig: buildWinningFunnelConfig(variant),
    leadFormQuestions: LEAD_FORM_QUESTIONS[leadType],
    thankYouPageText: THANK_YOU_TEXT[leadType],
    winningFamilyId: variant.familyId,
    variationType: variant.variantType,
    uniquenessFingerprint: variant.uniquenessFingerprint,
    vendorStyleTag: variant.vendorStyleTag,
    generatedBy: "winner_library",
    copySource: "winner_library",
  });
  const recommendedDraft = buildDraftFromVariant(selectedVariant);
  const selectedDrafts = selectedVariants.map(buildDraftFromVariant);

  return res.status(200).json({
    ok: true,
    draft: selectedDrafts[0] || recommendedDraft,
    drafts: selectedDrafts,
    variantCount: selectedDrafts.length,
  });
}
