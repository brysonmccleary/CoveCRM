import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import {
  type AudienceSegment,
  isWinnerSupportedLeadType,
} from "@/lib/facebook/winningAdLibrary";
import mongooseConnect from "@/lib/mongooseConnect";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import MetaAdMetricsDaily from "@/models/MetaAdMetricsDaily";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import { resolveAudienceSegment } from "@/lib/facebook/audienceTargeting";
import { generateCreativeIntelligenceDrafts } from "@/lib/facebook/creativeIntelligence";
import type { CreativeAudienceSegment, CreativeLanguage, CreativeVertical, ProductCapability } from "@/lib/facebook/creativeIntelligence";
import { reserveGeneratedDrafts } from "@/lib/facebook/creativeUsage";
import { scoreFamilyEvidence } from "@/lib/facebook/performanceLearning";

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

function spanishLeadFormQuestions(leadType: keyof typeof LEAD_FORM_QUESTIONS): readonly string[] {
  const shared = ["Nombre completo", "Número de teléfono", "Correo electrónico", "Estado"];
  if (leadType === "final_expense") {
    return [...shared, "Rango de edad (45-54 / 55-64 / 65-74 / 75-85)", "Cobertura deseada ($5,000-$25,000 / $25,000+)"];
  }
  if (leadType === "mortgage_protection") {
    return [...shared, "Saldo hipotecario aproximado", "Año de nacimiento", "¿Fuma? (Sí / No)"];
  }
  if (leadType === "iul") {
    return [...shared, "Edad", "Interés principal (Protección / Valor en efectivo / Jubilación / Legado)", "Cobertura actual"];
  }
  return LEAD_FORM_QUESTIONS[leadType];
}

function campaignLabel(leadType: string) {
  return leadType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, source: "creative_intelligence_engine" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // A tab left open across a deployment keeps running its old JavaScript.
  // Fail closed instead of letting that stale renderer keep generating the
  // retired layouts; the message is intentionally plain and user-facing.
  if ((req.body as any)?.mode === "wizard" && Number((req.body as any)?.clientCreativeVersion || 0) < 5) {
    return res.status(409).json({
      ok: false,
      error: "CoveCRM was updated. Refresh this page once to load the improved ad builder.",
    });
  }

  const {
    leadType = "mortgage_protection",
    location: locationParam = "",
    agentState = "",
    dailyBudget = 25,
    audienceSegment: audienceSegmentParam = "standard",
    regenerationAttempt: regenerationAttemptParam = 0,
    generationNonce: generationNonceParam = "",
  } = req.body as {
    leadType?: string;
    location?: string;
    agentState?: string;
    dailyBudget?: number;
    audienceSegment?: string;
    variantCount?: number;
    regenerationAttempt?: number;
    generationNonce?: string;
    productCapability?: ProductCapability | null;
  };

  if (!isWinnerSupportedLeadType(leadType)) {
    return res.status(400).json({
      ok: false,
      error: "This lead type is not available in the winning ad library.",
    });
  }

  const userEmail = String(session.user.email).toLowerCase();
  const location = String(locationParam || agentState || "").trim();
  let audienceSegment: AudienceSegment;
  try {
    audienceSegment = resolveAudienceSegment({ leadType, audienceSegment: audienceSegmentParam });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: error?.message || "Unsupported audience selection" });
  }
  const requestedVariantCount = Math.min(4, Math.max(1, Number((req.body as any)?.variantCount) || 3));
  const regenerationAttempt = Math.max(0, Number(regenerationAttemptParam) || 0);
  const generationNonce = String(generationNonceParam || "").trim() || `server_${Date.now().toString(36)}_${regenerationAttempt}`;
  const campaignName = location
    ? `${campaignLabel(leadType)} - ${location}`
    : `${campaignLabel(leadType)} Campaign`;

  // Creative Intelligence v1 is the single generation path for every supported
  // vertical and audience combination. Generation is Cove-only: no Meta object
  // is created until the separate Review & Launch route passes preflight.
  await mongooseConnect();
  const recentUsage = await MetaCreativeUsage.find({
    status: { $in: ["draft_reserved", "reserved", "published"] },
    $or: [
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(5000)
    .select("winningFamilyId layoutId headline primaryText description bulletPoints cta imageIdentity imageDirection backgroundDirection palette offerClass selectorSchema semanticFingerprint visualFingerprint -_id")
    .lean() as Array<Record<string, any>>;
  const normalizedRecentUsage = recentUsage.map((row) => ({
    ...row,
    selectorContract: row.selectorSchema || null,
  }));
  const learningCampaignIds = await FBLeadCampaign.find({
    leadType,
    attributionVersion: "signed-v1",
  }).select("_id").limit(5000).lean() as Array<{ _id: any }>;
  const familyEvidence = learningCampaignIds.length ? await MetaAdMetricsDaily.aggregate([
    { $match: { campaignId: { $in: learningCampaignIds.map((campaign) => campaign._id) }, creativeFamily: { $ne: "" } } },
    { $group: {
      _id: "$creativeFamily",
      spend: { $sum: { $ifNull: ["$spend", 0] } },
      impressions: { $sum: { $ifNull: ["$impressions", 0] } },
      leads: { $sum: { $ifNull: ["$leads", 0] } },
      qualifiedLeads: { $sum: "$qualifiedLeads" },
      appointments: { $sum: "$appointmentsBooked" },
      sales: { $sum: "$sales" },
      lastSeenAt: { $max: "$date" },
    } },
  ]) : [];
  const performanceWeights = Object.fromEntries(familyEvidence.map((row: any) => [
    String(row._id || ""),
    scoreFamilyEvidence({
      spend: row.spend, impressions: row.impressions, leads: row.leads,
      qualifiedLeads: row.qualifiedLeads, appointments: row.appointments,
      sales: row.sales, lastSeenAt: row.lastSeenAt,
    }).multiplier,
  ]));
  const language: CreativeLanguage = audienceSegment === "spanish" ? "es" : "en";
  const intelligenceDrafts = generateCreativeIntelligenceDrafts({
    vertical: leadType as CreativeVertical,
    audienceSegment: audienceSegment as CreativeAudienceSegment,
    language,
    userKey: userEmail,
    campaignName,
    location,
    requestedCount: requestedVariantCount,
    generationNonce,
    productCapability: (req.body as any)?.productCapability || null,
    recentUsage: normalizedRecentUsage,
    performanceWeights,
  }).map((draft, index) => ({
    ...draft,
    dailyBudgetCents: Math.round(Number(dailyBudget) * 100),
    regenerationAttempt,
    candidateBatch: index,
    leadFormQuestions: audienceSegment === "spanish"
      ? spanishLeadFormQuestions(leadType as keyof typeof LEAD_FORM_QUESTIONS)
      : LEAD_FORM_QUESTIONS[leadType as keyof typeof LEAD_FORM_QUESTIONS],
    thankYouPageText: audienceSegment === "spanish"
      ? "¡Gracias! Un agente autorizado se comunicará pronto para revisar sus opciones en español."
      : THANK_YOU_TEXT[leadType as keyof typeof THANK_YOU_TEXT],
  }));
  const budgetDollarsForEngine = Number(dailyBudget);
  if (!Number.isFinite(budgetDollarsForEngine) || budgetDollarsForEngine < 5) {
    return res.status(400).json({ ok: false, error: "dailyBudget must be a finite number >= 5" });
  }
  const reservation = await reserveGeneratedDrafts({
    userEmail,
    generationId: generationNonce,
    drafts: intelligenceDrafts,
  });
  return res.status(200).json({
    ok: true,
    draft: intelligenceDrafts[0],
    drafts: intelligenceDrafts,
    variantCount: intelligenceDrafts.length,
    creativeEngineVersion: 1,
    reservationId: reservation.reservationId,
    reservationExpiresAt: reservation.expiresAt.toISOString(),
    globalLearningHints: [],
  });
}
