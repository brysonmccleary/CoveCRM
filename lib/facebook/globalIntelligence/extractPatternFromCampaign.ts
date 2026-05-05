import { buildPatternFingerprint, normalizePatternText } from "./patternFingerprint";

type CampaignLike = Record<string, any>;

export type ExtractedGlobalPattern = {
  leadType: string;
  sourceType: string;
  winningFamilyId: string;
  variationType: string;
  vendorStyleTag: string;
  creativeArchetype: string;
  pageType: string;
  hookType: string;
  bodyAngle: string;
  ctaStyle: string;
  buttonStyle: string;
  colorDirection: string;
  headlineTemplate: string;
  primaryTextTemplate: string;
  imagePromptStyle: string;
  offerType: string;
  emotionalAngle: string;
  audienceAngle: string;
  qualifierAngle: string;
  trustAngle: string;
  benefitFocus: string;
  urgencyAngle: string;
  complianceFlags: string[];
  patternFingerprint: string;
  generationHints: {
    preferredHeadlinePatterns: string[];
    preferredPrimaryTextPatterns: string[];
    preferredButtonLabels: string[];
    preferredBenefitBullets: string[];
    preferredImageStyleNotes: string[];
    preferredHooks: string[];
    antiPatterns: string[];
  };
};

function safeParseNotes(notes: unknown): Record<string, any> {
  if (!notes || typeof notes !== "string") return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function textIncludes(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function classifyHookType(text: string, leadType: string): string {
  const t = text.toLowerCase();
  if (t.includes("?")) return "question";
  if (textIncludes(t, ["warning", "too late", "not prepared", "costs today"])) return "warning";
  if (textIncludes(t, ["veteran", "truck", "driver", "homeowner", "senior"])) return "identity_based";
  if (textIncludes(t, ["age", "50", "60", "70", "80"])) return "age_qualifier";
  if (textIncludes(t, ["$", "amount", "coverage", "100k", "250k"])) return "amount_qualifier";
  if (textIncludes(t, ["family", "loved", "burden", "protect what matters"])) return "emotional_family";
  if (textIncludes(t, ["compare", "better than", "vs"])) return "comparison";
  if (textIncludes(t, ["quick", "simple", "fast", "minute"])) return "direct_benefit";
  if (textIncludes(t, ["see if", "qualify", "available"])) return "curiosity";
  if (leadType === "veteran" || leadType === "trucker") return "identity_based";
  return "direct_benefit";
}

function classifyBodyAngle(text: string): string {
  const t = text.toLowerCase();
  if (textIncludes(t, ["burden", "stress", "worry", "peace of mind"])) return "fear_reduction";
  if (textIncludes(t, ["family", "loved ones", "protect"])) return "family_protection";
  if (textIncludes(t, ["qualify", "eligibility", "available"])) return "eligibility_check";
  if (textIncludes(t, ["save", "affordable", "few dollars", "rate"])) return "savings_value";
  if (textIncludes(t, ["simple", "no exam", "easy"])) return "simplicity";
  if (textIncludes(t, ["seconds", "minute", "fast", "quick"])) return "speed";
  if (textIncludes(t, ["licensed", "trusted", "private coverage", "review"])) return "authority_trust";
  return "benefit_forward";
}

function classifyOfferType(text: string): string {
  const t = text.toLowerCase();
  if (textIncludes(t, ["quote", "rate"])) return "quote";
  if (textIncludes(t, ["qualify", "eligibility"])) return "eligibility";
  if (textIncludes(t, ["review"])) return "review";
  if (textIncludes(t, ["benefit", "options"])) return "benefits_check";
  if (textIncludes(t, ["amount", "$", "coverage"])) return "amount_check";
  if (textIncludes(t, ["guide", "learn"])) return "guide";
  return "quote";
}

function classifyEmotionalAngle(text: string): string {
  const t = text.toLowerCase();
  if (textIncludes(t, ["peace", "simple", "reassurance", "worry"])) return "reassurance";
  if (textIncludes(t, ["today", "now", "too late", "fast"])) return "urgency";
  if (textIncludes(t, ["burden", "family", "loved"])) return "family_burden";
  if (textIncludes(t, ["veteran", "served", "patriotic"])) return "patriotic";
  if (textIncludes(t, ["home", "mortgage", "house"])) return "homeowner_pride";
  if (textIncludes(t, ["driver", "cdl", "road", "career"])) return "career_identity";
  return "neutral";
}

function classifyQualifierAngle(text: string): string {
  const t = text.toLowerCase();
  if (textIncludes(t, ["age", "50", "60", "70", "80"])) return "age";
  if (textIncludes(t, ["homeowner", "mortgage", "home"])) return "homeowner";
  if (textIncludes(t, ["veteran", "spouse", "dependent"])) return "veteran_status";
  if (textIncludes(t, ["driver", "cdl", "trucker"])) return "driver_status";
  if (textIncludes(t, ["coverage", "$", "amount"])) return "coverage_amount";
  return "none";
}

function complianceFlagsFor(text: string): string[] {
  const t = text.toLowerCase();
  const flags: string[] = [];
  if (textIncludes(t, ["guaranteed", "approved"])) flags.push("review_approval_claims");
  if (textIncludes(t, ["government", "va", "medicare", "official"])) flags.push("review_government_implication");
  if (textIncludes(t, ["death", "die"])) flags.push("review_direct_death_language");
  return flags;
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function compactStrings(values: unknown[], limit = 6): string[] {
  const out: string[] = [];
  for (const value of values.flat()) {
    const text = String(value || "").trim();
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

export function extractPatternFromCampaign(campaign: CampaignLike): ExtractedGlobalPattern | null {
  const leadType = String(campaign.leadType || "").trim();
  if (!leadType) return null;

  const notes = safeParseNotes(campaign.notes);
  const funnelData = notes.funnelData || {};
  const headline = firstNonEmpty(
    notes.headline,
    funnelData.adHeadline,
    funnelData.headline,
    `${leadType} campaign`
  );
  const primaryText = firstNonEmpty(notes.primaryText, funnelData.adPrimaryText, funnelData.subheadline);
  const imagePrompt = firstNonEmpty(notes.imagePrompt, funnelData.imagePrompt, funnelData.imageUrl);
  const combinedText = `${headline} ${primaryText} ${JSON.stringify(funnelData)}`;

  const pattern = {
    leadType,
    sourceType: "facebook_lead",
    winningFamilyId: firstNonEmpty(funnelData.winningFamilyId, notes.winningFamilyId),
    variationType: firstNonEmpty(funnelData.variationType, notes.variationType),
    vendorStyleTag: firstNonEmpty(funnelData.vendorStyleTag, notes.vendorStyleTag),
    creativeArchetype: firstNonEmpty(funnelData.creativeArchetype, notes.creativeArchetype),
    pageType: firstNonEmpty(funnelData.pageType, notes.pageType),
    hookType: classifyHookType(`${headline} ${primaryText}`, leadType),
    bodyAngle: classifyBodyAngle(primaryText || headline),
    ctaStyle: firstNonEmpty(funnelData.ctaStyle, notes.cta, funnelData.ctaStrip),
    buttonStyle: firstNonEmpty(funnelData.buttonStyle),
    colorDirection: firstNonEmpty(funnelData.colorDirection, funnelData.theme?.styleTag),
    headlineTemplate: normalizePatternText(headline),
    primaryTextTemplate: normalizePatternText(primaryText),
    imagePromptStyle: normalizePatternText(imagePrompt),
    offerType: classifyOfferType(combinedText),
    emotionalAngle: classifyEmotionalAngle(combinedText),
    audienceAngle: leadType,
    qualifierAngle: classifyQualifierAngle(combinedText),
    trustAngle: textIncludes(combinedText.toLowerCase(), ["licensed", "trusted", "private", "review"])
      ? "trust_review"
      : "",
    benefitFocus: firstNonEmpty(...compactStrings(funnelData.benefitBullets || [], 1), primaryText),
    urgencyAngle: textIncludes(combinedText.toLowerCase(), ["today", "now", "too late", "fast", "quick"])
      ? "timely_action"
      : "",
    complianceFlags: complianceFlagsFor(combinedText),
    generationHints: {
      preferredHeadlinePatterns: compactStrings([headline], 3),
      preferredPrimaryTextPatterns: compactStrings([primaryText], 3),
      preferredButtonLabels: compactStrings([funnelData.buttonLabels || [], funnelData.ctaStrip], 6),
      preferredBenefitBullets: compactStrings([funnelData.benefitBullets || []], 6),
      preferredImageStyleNotes: compactStrings([imagePrompt], 3),
      preferredHooks: compactStrings([headline, classifyHookType(`${headline} ${primaryText}`, leadType)], 4),
      antiPatterns: complianceFlagsFor(combinedText),
    },
  };

  return {
    ...pattern,
    patternFingerprint: buildPatternFingerprint(pattern),
  };
}
