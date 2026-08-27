export const META_AUDIENCE_POLICY_VERSION = "financial-services-us-v1-2026-08-25";

export type MetaLeadType =
  | "final_expense"
  | "iul"
  | "mortgage_protection"
  | "veteran"
  | "trucker";

export type AudienceSegment = "standard" | "veteran" | "trucker" | "spanish";
export type MortgageTargetingVariant = "mortgage_loans" | "mortgage_insurance";

export const VETERAN_TARGETING_MODE =
  "BROAD_META_DELIVERY_WITH_VETERAN_CREATIVE_FUNNEL_QUALIFICATION" as const;

type MetaInterest = { id: string; name: string };

export type MetaAudienceProfile = {
  key: string;
  leadType: MetaLeadType;
  audienceSegment: AudienceSegment;
  policyVersion: string;
  qualificationMode:
    | "product_interest"
    | "language_and_product_interest"
    | "identity_creative_and_funnel"
    | "interest_plus_identity_creative_and_funnel";
  deliveryMode: "META_DETAILED_TARGETING" | typeof VETERAN_TARGETING_MODE;
  mortgageTargetingVariant?: MortgageTargetingVariant;
  locales: number[];
  interestGroups: MetaInterest[][];
};

// These IDs were resolved through Meta's targeting search and then accepted by
// an ad-set validate_only request on a FINANCIAL_PRODUCTS_SERVICES campaign.
// Do not add an interest here from search results alone: many searchable
// interests are rejected for this special ad category.
const PRODUCT_INTEREST_GROUPS: Partial<Record<MetaLeadType, MetaInterest[][]>> = {
  final_expense: [[
    { id: "6003353637860", name: "Life insurance" },
  ]],
  iul: [
    [{ id: "6003353637860", name: "Life insurance" }],
    [
      { id: "6003331621377", name: "Investment strategy" },
      { id: "6003293787730", name: "Investment management" },
    ],
  ],
};

const SEGMENT_INTERESTS: Partial<Record<AudienceSegment, MetaInterest[]>> = {
  // Veteran and military interests were rejected for this special category.
  // Semi-trailer truck was independently accepted and is the primary signal
  // for new trucker campaigns. Do not OR it with the weaker Logistics signal.
  trucker: [{ id: "6003523283642", name: "Semi-trailer truck" }],
};

const MORTGAGE_INTERESTS: Record<MortgageTargetingVariant, MetaInterest> = {
  mortgage_loans: { id: "6003141785766", name: "Mortgage loans" },
  mortgage_insurance: { id: "6003644772146", name: "Mortgage insurance" },
};

const SPANISH_ALL_LOCALE = 1002;
const LEAD_TYPES = new Set<MetaLeadType>([
  "final_expense",
  "iul",
  "mortgage_protection",
  "veteran",
  "trucker",
]);
const AUDIENCE_SEGMENTS = new Set<AudienceSegment>(["standard", "veteran", "trucker", "spanish"]);

function parseLeadType(value: unknown): MetaLeadType {
  const leadType = String(value || "").trim() as MetaLeadType;
  if (!LEAD_TYPES.has(leadType)) throw new Error(`Unsupported Meta lead type: ${leadType || "missing"}`);
  return leadType;
}

export function resolveAudienceSegment(input: {
  leadType: unknown;
  audienceSegment?: unknown;
}): AudienceSegment {
  const leadType = parseLeadType(input.leadType);
  const raw = String(input.audienceSegment || "standard").trim().toLowerCase() as AudienceSegment;
  if (!AUDIENCE_SEGMENTS.has(raw)) throw new Error(`Unsupported audience segment: ${raw || "missing"}`);

  // General veteran/trucker choices used to arrive as "standard" from the
  // wizard. Canonicalize them server-side so a UI regression cannot launch the
  // wrong funnel, form questions, or targeting profile again.
  if (leadType === "veteran") {
    if (raw !== "standard" && raw !== "veteran") {
      throw new Error(`Veteran campaigns cannot use the ${raw} audience segment`);
    }
    return "veteran";
  }
  if (leadType === "trucker") {
    if (raw !== "standard" && raw !== "trucker") {
      throw new Error(`Trucker campaigns cannot use the ${raw} audience segment`);
    }
    return "trucker";
  }
  if (raw === "veteran" && !["mortgage_protection", "iul", "final_expense"].includes(leadType)) {
    throw new Error(`The veteran audience is not supported for ${leadType}`);
  }
  if (raw === "trucker" && !["mortgage_protection", "iul", "final_expense"].includes(leadType)) {
    throw new Error(`The trucker audience is not supported for ${leadType}`);
  }
  return raw;
}

export function getMetaAudienceProfile(input: {
  leadType: unknown;
  audienceSegment?: unknown;
  mortgageTargetingVariant?: unknown;
}): MetaAudienceProfile {
  const leadType = parseLeadType(input.leadType);
  const audienceSegment = resolveAudienceSegment({ leadType, audienceSegment: input.audienceSegment });
  const interestGroups: MetaInterest[][] = [];
  const segmentInterests = SEGMENT_INTERESTS[audienceSegment];
  const mortgageTargetingVariant: MortgageTargetingVariant =
    String(input.mortgageTargetingVariant || "mortgage_loans") === "mortgage_insurance"
      ? "mortgage_insurance"
      : "mortgage_loans";
  const productInterestGroups = leadType === "mortgage_protection"
    ? [[MORTGAGE_INTERESTS[mortgageTargetingVariant]]]
    : PRODUCT_INTEREST_GROUPS[leadType];

  if (segmentInterests?.length) interestGroups.push(segmentInterests);
  if (productInterestGroups?.length) interestGroups.push(...productInterestGroups);

  const identityQualified = audienceSegment === "veteran" || audienceSegment === "trucker";
  const qualificationMode = audienceSegment === "spanish"
    ? "language_and_product_interest"
    : identityQualified && interestGroups.length
      ? "interest_plus_identity_creative_and_funnel"
      : identityQualified
        ? "identity_creative_and_funnel"
        : "product_interest";

  return {
    key: `${leadType}:${audienceSegment}${leadType === "mortgage_protection" ? `:${mortgageTargetingVariant}` : ""}`,
    leadType,
    audienceSegment,
    policyVersion: META_AUDIENCE_POLICY_VERSION,
    qualificationMode,
    deliveryMode: audienceSegment === "veteran"
      ? VETERAN_TARGETING_MODE
      : "META_DETAILED_TARGETING",
    ...(leadType === "mortgage_protection" ? { mortgageTargetingVariant } : {}),
    locales: audienceSegment === "spanish" ? [SPANISH_ALL_LOCALE] : [],
    interestGroups,
  };
}

export function applyMetaAudienceProfile(baseTargeting: Record<string, any>, profile: MetaAudienceProfile) {
  const targeting: Record<string, any> = { ...baseTargeting };
  if (profile.locales.length) targeting.locales = [...profile.locales];
  if (profile.interestGroups.length) {
    targeting.flexible_spec = profile.interestGroups.map((interests) => ({
      interests: interests.map((interest) => ({ ...interest })),
    }));
  }
  return targeting;
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function assertAudienceCreativeMatch(input: {
  leadType: unknown;
  audienceSegment?: unknown;
  creativeText: unknown;
  landingPageText?: unknown;
}) {
  const profile = getMetaAudienceProfile(input);
  const creativeText = String(input.creativeText || "").toLowerCase();
  const landingPageText = String(input.landingPageText || "").toLowerCase();
  const combined = `${creativeText}\n${landingPageText}`;

  const productPatterns: Partial<Record<MetaLeadType, RegExp[]>> = {
    final_expense: [/final expense/i, /gastos finales/i, /burial/i, /funeral/i, /whole life/i, /coverage/i],
    mortgage_protection: [/mortgage/i, /home protection/i, /protect (?:your|the) home/i, /hipoteca/i, /hogar/i],
    iul: [/\biul\b/i, /indexed universal life/i, /cash value/i, /valor en efectivo/i, /vida universal indexada/i],
  };
  const requiredProductPatterns = productPatterns[profile.leadType];
  if (requiredProductPatterns && !matchesAny(combined, requiredProductPatterns)) {
    throw new Error(`Creative and funnel do not match the ${profile.leadType} product audience`);
  }

  if (profile.audienceSegment === "veteran" && !matchesAny(combined, [
    /veteran/i,
    /\bserved?\b/i,
    /military/i,
    /\barmy\b|\bnavy\b|\bmarines?\b|\bair force\b|\bcoast guard\b|\bspace force\b/i,
  ])) {
    throw new Error("Veteran campaigns must explicitly qualify veterans or military families in the creative and funnel");
  }
  if (profile.audienceSegment === "trucker" && !matchesAny(combined, [
    /trucker/i,
    /truck driver/i,
    /\bcdl\b/i,
    /owner[- ]operator/i,
    /\bhauling\b|\bhaul\b/i,
  ])) {
    throw new Error("Trucker campaigns must explicitly qualify CDL drivers or truckers in the creative and funnel");
  }
  if (profile.audienceSegment === "spanish" && !matchesAny(creativeText, [
    /[¿¡]/,
    /\bcobertura\b/i,
    /\bseguro\b/i,
    /\bprotecci[oó]n\b/i,
    /\bopciones\b/i,
    /\bfamilia\b/i,
  ])) {
    throw new Error("Spanish campaigns must use Spanish-language ad copy");
  }
  return profile;
}

export function assertAllAudienceCreativeMatches(input: {
  leadType: unknown;
  audienceSegment?: unknown;
  creatives: Array<{ primaryText?: unknown; headline?: unknown; description?: unknown }>;
  landingPageText?: unknown;
}) {
  if (!Array.isArray(input.creatives) || !input.creatives.length) {
    throw new Error("At least one creative is required");
  }
  return input.creatives.map((creative, index) => {
    try {
      return assertAudienceCreativeMatch({
        leadType: input.leadType,
        audienceSegment: input.audienceSegment,
        creativeText: [creative?.primaryText, creative?.headline, creative?.description].filter(Boolean).join("\n"),
        landingPageText: input.landingPageText,
      });
    } catch (error: any) {
      throw new Error(`Creative ${index + 1} failed audience/product/language validation: ${error?.message || "mismatch"}`);
    }
  });
}
