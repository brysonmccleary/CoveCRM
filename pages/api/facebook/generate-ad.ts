import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import {
  type AudienceSegment,
  buildWinningFunnelConfig,
  generateWinningVariantList,
  isWinnerSupportedLeadType,
} from "@/lib/facebook/winningAdLibrary";
import {
  applyGlobalWinnerHints,
  loadGlobalGenerationHints,
} from "@/lib/facebook/globalIntelligence/anonymizedLearning";
import mongooseConnect from "@/lib/mongooseConnect";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import { buildCreativeGenerationSignature } from "@/lib/facebook/creativeIdentity";
import { selectCreativeTreatmentMix } from "@/lib/facebook/creativeCandidateSelection";
import { resolveAudienceSegment } from "@/lib/facebook/audienceTargeting";
import {
  buildApprovedTruckerLibrary,
  getApprovedTruckerLane,
  selectApprovedTruckerConcepts,
} from "@/lib/facebook/approvedTruckerCreative";
import {
  buildApprovedVeteranLibrary,
  selectApprovedVeteranConcepts,
} from "@/lib/facebook/approvedVeteranCreative";

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

function hashString(value: string): number {
  let hash = 0;
  const str = value || "covecrm";
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function visualVariantCount(leadType: string): number {
  const counts: Record<string, number> = {
    veteran: 40,
    trucker: 40,
    final_expense: 40,
    mortgage_protection: 40,
    iul: 40,
  };
  return counts[leadType] || 40;
}

function sanitizeCreativeText(value: string, leadType: string): string {
  let sanitized = String(value || "");

  const replacements: Array<[RegExp, string]> = [
    [/benefit unlock/gi, "coverage options"],
    [/benefits civilians will never access/gi, "private coverage options designed for veterans"],
    [/civilians will never access/gi, "many people may not know about"],
    [/not available to civilians/gi, "available through a private coverage review"],
    [/not available to the general public/gi, "available through a private coverage review"],
    [/guaranteed approval/gi, "simple review"],
    [/guaranteed acceptance/gi, "coverage options may be available"],
    [/fast approval/gi, "fast review"],
    [/family at home/gi, "structured direct-response layout"],
    [/young family/gi, "home-focused visual"],
    [/couple at home/gi, "home-focused visual"],
    [/warm natural lighting/gi, "high-contrast direct-response lighting"],
    [/warm cinematic/gi, "high-contrast direct-response"],
    [/candid family photography/gi, "poster-style ad creative"],
    [/lifestyle photography/gi, "direct-response poster layout"],
    [/government program/gi, "private coverage review"],
    [/government implication/gi, "private coverage framing"],
    [/official-sounding entitlement language/gi, "private coverage options"],
    [/plans options designe\w*/gi, "coverage options designed"],
    [/\bplans options\b/gi, "coverage options"],
    [/\bcoverage coverage\b/gi, "coverage"],
    [/\boptions options\b/gi, "options"],
  ];

  if (leadType === "veteran") {
    replacements.push(
      [/private coverage\s*[—-]\s*not va/gi, "coverage options for those who served"],
      [/private market coverage\s*[—-]\s*not va/gi, "coverage options for those who served"],
      [/private market\s*[—-]\s*not va/gi, "coverage for those who served"],
      [/not affiliated with (?:the )?va/gi, "built for veterans and military families"],
      [/not affiliated with veterans affairs/gi, "built for veterans and military families"],
      [/\bnot va\b/gi, "built for veterans"],
      [/\bnot a va program\b/gi, "coverage options for veterans and military families"],
      [/\bnot va\/government\b/gi, "veteran-focused coverage options"],
      [/independently offered\/not government/gi, "offered through a licensed coverage review"],
      [/independently offered and not government/gi, "offered through a licensed coverage review"],
      [/not (?:a )?government program/gi, "coverage options for veterans and military families"],
      [/30-year term/gi, "whole life coverage options"],
      [/term coverage/gi, "whole life coverage options"],
      [/term life/gi, "whole life coverage options"],
      [/term policy/gi, "whole life coverage options"]
    );
  }

  for (const [pattern, replacement] of replacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

function sanitizeCreativeList(values: string[] | undefined, leadType: string): string[] {
  return (values || []).map((value) => sanitizeCreativeText(value, leadType));
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

  // A tab left open across a deployment keeps running its old JavaScript.
  // Fail closed instead of letting that stale renderer keep generating the
  // retired layouts; the message is intentionally plain and user-facing.
  if ((req.body as any)?.mode === "wizard" && Number((req.body as any)?.clientCreativeVersion || 0) < 4) {
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
    licensedStates = [],
  } = req.body as {
    leadType?: string;
    location?: string;
    agentState?: string;
    dailyBudget?: number;
    audienceSegment?: string;
    variantCount?: number;
    regenerationAttempt?: number;
    generationNonce?: string;
    licensedStates?: string[];
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
  const approvedTruckerLane = getApprovedTruckerLane(leadType, audienceSegment);
  const approvedVeteranLane = leadType === "veteran" && audienceSegment === "veteran";
  const requestedVariantCount = Math.min(
    approvedTruckerLane || approvedVeteranLane ? 5 : 4,
    Math.max(1, Number((req.body as any)?.variantCount) || 3)
  );
  const regenerationAttempt = Math.max(0, Number(regenerationAttemptParam) || 0);
  const generationNonce = String(generationNonceParam || "").trim() || `server_${Date.now().toString(36)}_${regenerationAttempt}`;
  const campaignName = location
    ? `${campaignLabel(leadType)} - ${location}`
    : `${campaignLabel(leadType)} Campaign`;

  const campaignNameSeeded = [
    campaignName,
    userEmail,
    leadType,
    audienceSegment,
    location,
    `attempt:${regenerationAttempt}`,
    `nonce:${generationNonce}`,
  ].join("|");

  const selectedVariantsFromLibrary = generateWinningVariantList({
    leadType,
    audienceSegment,
    userId: userEmail,
    campaignName: campaignNameSeeded,
    location,
    variantCount: requestedVariantCount,
  });
  const globalLearningHints = await loadGlobalGenerationHints({
    leadType,
    stateCodes: Array.isArray(licensedStates) ? licensedStates : [],
  });
  const selectedVariants = applyGlobalWinnerHints(selectedVariantsFromLibrary, globalLearningHints);
  const budgetDollars = Number(dailyBudget);
  if (!Number.isFinite(budgetDollars) || budgetDollars < 5) {
    return res.status(400).json({ ok: false, error: "dailyBudget must be a finite number >= 5" });
  }
  const dailyBudgetCents = Math.round(budgetDollars * 100);

  if (approvedVeteranLane) {
    const approvedLibrary = buildApprovedVeteranLibrary();
    await mongooseConnect();
    const usedRows = await MetaCreativeUsage.find({
      variationType: { $in: [...new Set(approvedLibrary.map((concept) => concept.visualConceptId))] },
      status: { $in: ["draft_reserved", "reserved", "published"] },
    }).select("variationType -_id").lean();
    const usedVisualConceptIds = new Set(
      (usedRows as any[]).map((row) => String(row.variationType || "")).filter(Boolean)
    );
    const approvedConcepts = selectApprovedVeteranConcepts({
      seed: campaignNameSeeded,
      count: requestedVariantCount,
      usedVisualConceptIds,
    });
    const funnelVariant = selectedVariantsFromLibrary[0];
    if (!funnelVariant) {
      return res.status(409).json({ ok: false, error: "The selected Veteran funnel is unavailable." });
    }
    const funnelConfig = buildWinningFunnelConfig(funnelVariant);
    const selectedDrafts = approvedConcepts.map((concept) => {
      const marketDirect = concept.masterKind === "market_direct";
      const offerFirst = concept.masterId === "VET_MARKET_01";
      const coverageAmount = concept.heroAmount
        ? `$${concept.heroAmount.toLocaleString("en-US")}`
        : "";
      const draft = {
        leadType,
        audienceSegment,
        campaignName,
        dailyBudgetCents,
        primaryText: marketDirect
          ? (offerFirst
            ? `Veterans and military families: explore whole life coverage options up to ${coverageAmount}. No medical exam, no 2-year wait, and instant approval options are available. Select your age to see your options.`
            : `Veterans: help protect your family from final expenses with private whole life coverage options up to ${coverageAmount}. Review available options with a licensed insurance professional.`)
          : "Private whole life coverage options for veterans and military families. A licensed professional can review available choices.",
        headline: marketDirect
          ? (offerFirst ? `Veterans: See Whole Life Options Up to ${coverageAmount}` : "Veterans: Help Protect Your Family")
          : concept.headline.join(" "),
        description: marketDirect ? "Private coverage. No obligation." : "Private coverage review by age.",
        cta: marketDirect ? "GET_QUOTE" : concept.cta,
        imagePrompt: "",
        videoScript: "",
        buttonLabels: concept.ageOptions,
        bulletPoints: concept.benefits,
        creativeArchetype: concept.masterKind,
        landingPageConfig: {
          ...funnelConfig,
          headline: sanitizeCreativeText(funnelConfig.headline, leadType),
          subheadline: sanitizeCreativeText(funnelConfig.subheadline, leadType),
          buttonLabels: sanitizeCreativeList(funnelConfig.buttonLabels, leadType),
          benefitBullets: sanitizeCreativeList(funnelConfig.benefitBullets, leadType),
          ctaStrip: sanitizeCreativeText(funnelConfig.ctaStrip, leadType),
        },
        leadFormQuestions: LEAD_FORM_QUESTIONS[leadType],
        thankYouPageText: THANK_YOU_TEXT[leadType],
        winningFamilyId: `vet_approved_${concept.masterId.toLowerCase()}`,
        variationType: concept.visualConceptId,
        uniquenessFingerprint: concept.renderFingerprint,
        generationNonce,
        regenerationAttempt,
        visualVariantIndex: Math.max(0, Number(concept.backgroundAssetId?.match(/(\d+)$/)?.[1] || 1) - 1),
        visualTreatment: concept.backgroundAssetId ? "photo" : "graphic",
        candidateBatch: 0,
        vendorStyleTag: `approved_veteran_${concept.imageTreatment}`,
        displayAmount: concept.heroAmount ? `$${concept.heroAmount.toLocaleString("en-US")}` : "",
        generatedBy: "approved_veteran_library",
        copySource: "approved_veteran_library",
        approvedVeteranConcept: concept,
      };
      return {
        ...draft,
        creativeSignature: buildCreativeGenerationSignature(draft),
      };
    });

    return res.status(200).json({
      ok: true,
      draft: selectedDrafts[0],
      drafts: selectedDrafts,
      variantCount: selectedDrafts.length,
      globalLearningHints: {},
    });
  }

  if (approvedTruckerLane) {
    const approvedLibrary = buildApprovedTruckerLibrary(approvedTruckerLane);
    await mongooseConnect();
    const usedRows = await MetaCreativeUsage.find({
      variationType: { $in: approvedLibrary.map((concept) => concept.visualConceptId) },
      status: { $in: ["draft_reserved", "reserved", "published"] },
    }).select("variationType -_id").lean();
    const usedVisualConceptIds = new Set(
      (usedRows as any[]).map((row) => String(row.variationType || "")).filter(Boolean)
    );
    const approvedConcepts = selectApprovedTruckerConcepts({
      lane: approvedTruckerLane,
      seed: campaignNameSeeded,
      count: requestedVariantCount,
      usedVisualConceptIds,
    });
    const funnelVariant = selectedVariantsFromLibrary[0];
    if (!funnelVariant) {
      return res.status(409).json({ ok: false, error: "The selected Trucker funnel is unavailable." });
    }
    const funnelConfig = buildWinningFunnelConfig(funnelVariant);
    const selectedDrafts = approvedConcepts.map((concept) => {
      const draft = {
        leadType,
        audienceSegment,
        campaignName,
        dailyBudgetCents,
        primaryText: concept.master.subhead,
        headline: concept.master.headline,
        description: concept.master.subhead,
        cta: concept.master.cta,
        imagePrompt: "",
        videoScript: "",
        buttonLabels: concept.master.qualifier,
        bulletPoints: concept.master.bullets,
        creativeArchetype: concept.master.kind,
        landingPageConfig: {
          ...funnelConfig,
          headline: sanitizeCreativeText(funnelConfig.headline, leadType),
          subheadline: sanitizeCreativeText(funnelConfig.subheadline, leadType),
          buttonLabels: sanitizeCreativeList(funnelConfig.buttonLabels, leadType),
          benefitBullets: sanitizeCreativeList(funnelConfig.benefitBullets, leadType),
          ctaStrip: sanitizeCreativeText(funnelConfig.ctaStrip, leadType),
        },
        leadFormQuestions: LEAD_FORM_QUESTIONS[leadType],
        thankYouPageText: THANK_YOU_TEXT[leadType],
        winningFamilyId: concept.master.id,
        variationType: concept.visualConceptId,
        uniquenessFingerprint: concept.visualConceptId,
        generationNonce,
        regenerationAttempt,
        visualVariantIndex: concept.imageNumber - 1,
        visualTreatment: concept.visualTreatment,
        candidateBatch: 0,
        vendorStyleTag: `approved_trucker_${concept.treatment.toLowerCase()}`,
        displayAmount: "",
        generatedBy: "approved_trucker_library",
        copySource: "approved_trucker_library",
        approvedTruckerConcept: concept,
      };
      return {
        ...draft,
        creativeSignature: buildCreativeGenerationSignature(draft),
      };
    });

    return res.status(200).json({
      ok: true,
      draft: selectedDrafts[0],
      drafts: selectedDrafts,
      variantCount: selectedDrafts.length,
      globalLearningHints: {},
    });
  }

  const buildDraftFromVariant = (
    variant: (typeof selectedVariants)[number],
    index = 0,
    draftNonce = generationNonce,
    candidateBatch = 0
  ) => {
    const landingPageConfig = buildWinningFunnelConfig(variant);
    const visualVariantBaseSeed = [
      userEmail,
      leadType,
      audienceSegment,
      draftNonce,
      String(index),
      String(regenerationAttempt),
    ].join("|");
    const visualVariantIndex = Math.abs(hashString(visualVariantBaseSeed)) % visualVariantCount(leadType);
    const visualLeadType = audienceSegment === "veteran" || audienceSegment === "trucker"
      ? audienceSegment
      : leadType;
    const photoPercent = visualLeadType === "trucker"
      ? 75
      : visualLeadType === "veteran"
      ? 60
      : visualLeadType === "mortgage_protection"
      ? 65
      : 0;
    const visualTreatment = Math.abs(hashString(`${visualVariantBaseSeed}|treatment`)) % 100 < photoPercent
      ? "photo"
      : "graphic";

    const draft = {
      leadType,
      audienceSegment,
      campaignName,
      dailyBudgetCents,
      primaryText: sanitizeCreativeText(variant.primaryText, leadType),
      headline: sanitizeCreativeText(variant.headline, leadType),
      description: sanitizeCreativeText(variant.description, leadType),
      cta: sanitizeCreativeText(variant.cta, leadType),
      imagePrompt: sanitizeCreativeText(
        [
          variant.imagePrompt,
          `Creative variation seed ${draftNonce}. Use a noticeably different direct-response background treatment, palette, composition, and subject framing from prior attempts. Leave blank reserved headline and CTA areas for app-rendered text. No readable text inside image.`,
        ].join(" "),
        leadType
      ),
      videoScript: sanitizeCreativeText(variant.videoScript, leadType),
      buttonLabels: sanitizeCreativeList(variant.buttonLabels, leadType),
      bulletPoints: sanitizeCreativeList(variant.bulletPoints, leadType),
      creativeArchetype: variant.archetype,
      landingPageConfig: {
        ...landingPageConfig,
        headline: sanitizeCreativeText(landingPageConfig.headline, leadType),
        subheadline: sanitizeCreativeText(landingPageConfig.subheadline, leadType),
        buttonLabels: sanitizeCreativeList(landingPageConfig.buttonLabels, leadType),
        benefitBullets: sanitizeCreativeList(landingPageConfig.benefitBullets, leadType),
        ctaStrip: sanitizeCreativeText(landingPageConfig.ctaStrip, leadType),
      },
      leadFormQuestions: audienceSegment === "spanish" ? spanishLeadFormQuestions(leadType) : LEAD_FORM_QUESTIONS[leadType],
      thankYouPageText: audienceSegment === "spanish" ? "¡Gracias! Un agente autorizado se comunicará pronto para revisar sus opciones en español." : THANK_YOU_TEXT[leadType],
      winningFamilyId: variant.familyId,
      variationType: variant.variantType,
      uniquenessFingerprint: variant.uniquenessFingerprint,
      generationNonce: draftNonce,
      regenerationAttempt,
      visualVariantIndex,
      visualTreatment,
      candidateBatch,
      vendorStyleTag: variant.vendorStyleTag,
      displayAmount: variant.displayAmount,
      generatedBy: "winner_library",
      copySource: "winner_library",
    };
    return {
      ...draft,
      creativeSignature: buildCreativeGenerationSignature(draft),
    };
  };

  // Build a deep candidate bench, then remove every semantic design already
  // reserved or published anywhere on CoveCRM. A final rendered-byte claim at
  // publish time remains the atomic authority for concurrent requests.
  const candidateDrafts: Array<Record<string, any>> = [];
  for (let batch = 0; batch < 32; batch++) {
    const batchNonce = batch === 0 ? generationNonce : `${generationNonce}|bench:${batch}`;
    const batchCampaignSeed = [
      campaignName,
      userEmail,
      leadType,
      audienceSegment,
      location,
      `attempt:${regenerationAttempt}`,
      `nonce:${batchNonce}`,
    ].join("|");
    const batchVariants = batch === 0
      ? selectedVariants
      : applyGlobalWinnerHints(generateWinningVariantList({
          leadType,
          audienceSegment,
          userId: userEmail,
          campaignName: batchCampaignSeed,
          location,
          variantCount: 4,
        }), globalLearningHints);
    batchVariants.forEach((variant, index) => {
      candidateDrafts.push(buildDraftFromVariant(variant, index, batchNonce, batch));
    });
  }

  const uniqueCandidates = Array.from(
    new Map(candidateDrafts.map((draft) => [draft.creativeSignature, draft])).values()
  );
  await mongooseConnect();
  const usedRows = await MetaCreativeUsage.find({
    generationSignature: { $in: uniqueCandidates.map((draft) => draft.creativeSignature) },
  }).select("generationSignature -_id").lean();
  const usedSignatures = new Set((usedRows as any[]).map((row) => String(row.generationSignature || "")));
  const freshCandidates = uniqueCandidates
    .filter((draft) => !usedSignatures.has(String(draft.creativeSignature)));
  const visualLeadType = audienceSegment === "veteran" || audienceSegment === "trucker"
    ? audienceSegment
    : leadType;
  const selectedDrafts = selectCreativeTreatmentMix(
    freshCandidates,
    requestedVariantCount,
    ["veteran", "trucker", "mortgage_protection"].includes(visualLeadType)
  );

  if (selectedDrafts.length < requestedVariantCount) {
    return res.status(409).json({
      ok: false,
      error: "The fresh creative pool is temporarily exhausted for this selection. Regenerate once for a new set.",
    });
  }

  return res.status(200).json({
    ok: true,
    draft: selectedDrafts[0],
    drafts: selectedDrafts,
    variantCount: selectedDrafts.length,
    globalLearningHints,
  });
}
