export type CreativeVertical =
  | "veteran"
  | "final_expense"
  | "mortgage_protection"
  | "iul"
  | "trucker";

export type CreativeAudienceSegment = "standard" | "veteran" | "trucker" | "spanish";
export type CreativeLanguage = "en" | "es";
export type CreativeClass = "core" | "adjacent" | "experimental";
export type MarketEvidenceStatus =
  | "OBSERVED_IN_MARKET"
  | "REPEATED_ACROSS_ADVERTISERS"
  | "LONGEVITY_SIGNAL"
  | "COVE_INTERNAL_PERFORMANCE"
  | "APPROVED_COVE_CLAIM";

export type CreativeFormat =
  | "graphic"
  | "photo"
  | "video"
  | "ugc_video"
  | "agent_video";

export type SelectorType =
  | "age_range"
  | "coverage_amount"
  | "military_status"
  | "branch"
  | "mortgage_balance"
  | "occupation"
  | "state"
  | "product_qualifier"
  | "other";

export type LayoutId =
  | "hero_amount_age_grid"
  | "audience_benefit_grid"
  | "problem_consequence_offer"
  | "portrait_hero_offer"
  | "full_bleed_text_overlay"
  | "notice_letter_paper"
  | "family_lifestyle_offer"
  | "comparison_two_column"
  | "educational_explainer_card"
  | "calculator_quiz_assessment"
  | "ugc_talking_head"
  | "agent_trust_explainer";

export type MarketEvidence = {
  observedCount: number;
  advertiserCount: number;
  observationDate: string;
  longevityClass: "emerging" | "repeated" | "long_running";
  evidenceStrength: "low" | "moderate" | "strong";
  performanceKnown: boolean;
  statuses: MarketEvidenceStatus[];
};

export type SelectorContract = {
  selectorId: string;
  type: SelectorType;
  label: string;
  options: string[];
  funnelStepId: string;
  required: boolean;
  eligibilityRepresentation: boolean;
  source: "safe_default" | "product_capability" | "vertical_configuration";
};

export type ProductCapability = {
  capabilityId: string;
  carrier: string;
  product: string;
  productIdentifier: string;
  products: CreativeVertical[];
  states: string[];
  issueAgeMin: number | null;
  issueAgeMax: number | null;
  faceAmountMin: number | null;
  faceAmountMax: number | null;
  waitingPeriodRules: string[];
  immediateBenefitRules: string[];
  gradedBenefitRules: string[];
  medicalExamRequirement: "required" | "not_required" | "conditional" | "unknown";
  underwritingType: string;
  premiumGuarantees: string[];
  benefitGuarantees: string[];
  livingBenefits: string[];
  taxTreatmentCapabilities: string[];
  approvalSpeedCapabilities: string[];
  otherCapabilities: string[];
  effectiveDate: string;
  expiresAt?: string;
  approvalSource: string;
  approvalMetadata: Record<string, unknown>;
  active: boolean;
};

export type CreativeFamilyDefinition = {
  familyId: string;
  vertical: CreativeVertical;
  audienceSegments: CreativeAudienceSegment[];
  products: CreativeVertical[];
  languages: CreativeLanguage[];
  marketEvidence: MarketEvidence;
  creativeClass: CreativeClass;
  formats: CreativeFormat[];
  layoutIds: LayoutId[];
  hookClass: string;
  headlineClass: string;
  offerClass: string;
  imageDirections: string[];
  backgroundDirections: string[];
  selectorTypes: SelectorType[];
  ctaClass: string;
  requiredCapabilities: string[];
  allowedClaims: string[];
  requiredDisclosures: string[];
  funnelCompatibility: string[];
  targetingCompatibility: string[];
  initialWeight: number;
  explorationFloor: number;
  headlines: string[];
  hooks: string[];
  benefitLists: string[][];
  ctas: string[];
  spanish?: {
    headlines: string[];
    hooks: string[];
    benefitLists: string[][];
    ctas: string[];
  };
};

export type CreativeEngineInput = {
  vertical: CreativeVertical;
  audienceSegment: CreativeAudienceSegment;
  language: CreativeLanguage;
  userKey: string;
  campaignName: string;
  location?: string;
  capabilityState?: string;
  applicantAge?: number;
  requestedCount: number;
  generationNonce: string;
  productCapability?: ProductCapability | null;
  preferredFamilyId?: string;
  recentUsage?: Array<Record<string, unknown>>;
  performanceWeights?: Record<string, number>;
  productionAssets?: import("@/lib/facebook/creativeAssets/types").ProductionCreativeAsset[];
};

export type CreativeEngineDraft = Record<string, unknown> & {
  leadType: CreativeVertical;
  audienceSegment: CreativeAudienceSegment;
  language: CreativeLanguage;
  winningFamilyId: string;
  creativeFamily: string;
  creativeClass: CreativeClass;
  layoutId: LayoutId;
  hookClass: string;
  headlineClass: string;
  offerClass: string;
  imageDirection: string;
  backgroundDirection: string;
  selectorContract: SelectorContract;
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  buttonLabels: string[];
  bulletPoints: string[];
  landingPageConfig: Record<string, unknown>;
  marketEvidence: MarketEvidence;
  allowedClaimIds: string[];
  requiredCapabilities: string[];
  requiredDisclosures: string[];
  capabilityId: string;
  capabilitySource: "configured_product" | "safe_general";
  displayAmount?: string;
  visibleIdentityLabel: string;
  capabilityBenefits: string[];
  copyMode: "safe_direct_response" | "capability_enhanced_direct_response";
  cssExecutionId: string;
  cssMacroFamily: string;
  cssRendererFamily: import("./executions").CssRendererFamily;
  cssHierarchyTreatment: string;
  cssPanelStructure: string;
  cssBackgroundTreatment: string;
  cssTypographyTreatment: string;
  cssSelectorPresentation: string;
  cssCtaTreatment: string;
  cssFrameTreatment: string;
  cssCompositionVariant: import("./executions").CssCompositionVariant;
  cssBenefitTreatment: string;
  cssHeroTreatment: string;
  cssWhitespaceTreatment: string;
  cssPaletteIndex: number;
  variantId: string;
};
