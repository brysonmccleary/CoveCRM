import MetaClaimRegistry from "@/models/MetaClaimRegistry";

export type RegisteredClaim = {
  _id?: any;
  claimText: string;
  pattern: string;
  classification: "CLEAN" | "QUALIFIED";
  eligibleProducts: string[];
  carrierBasis: string;
  requiredQualifierText?: string;
  states: string[];
  version: string;
  expiresAt: Date | string;
  approvedBy: string;
  approvalEvidence?: string;
  approvedAt?: Date | string;
  claimId?: string;
  canonicalMeaning?: string;
  requiredCapabilities?: string[];
  requiredDisclosure?: string;
  approvalSource?: string;
  effectiveVersion?: string;
  riskLevel?: "low" | "medium" | "high" | "prohibited_without_evidence";
};

const FAR_FUTURE = new Date("2030-12-31T23:59:59.999Z");

export const DEFAULT_META_CLAIMS: RegisteredClaim[] = [
  {
    claimText: "No 2 Year Wait",
    pattern: "no\\s+(?:two|2)[ -]?year\\s+wait",
    classification: "QUALIFIED",
    eligibleProducts: ["final_expense"],
    carrierBasis: "Level-benefit final-expense products for applicants meeting carrier health eligibility.",
    requiredQualifierText: "No two-year waiting period is available for those who qualify based on health.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
    claimId: "no_two_year_wait", requiredCapabilities: ["waiting_period:none"], riskLevel: "high",
  },
  {
    claimText: "No Medical Exam",
    pattern: "no\\s+(?:medical\\s+)?exam",
    classification: "CLEAN",
    eligibleProducts: ["final_expense", "iul", "mortgage_protection", "veteran", "trucker"],
    carrierBasis: "Simplified-issue products that do not require a paramedical examination.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
    claimId: "no_medical_exam", requiredCapabilities: ["medical_exam:not_required"], riskLevel: "high",
  },
  {
    claimText: "$1,000,000 No Exam",
    pattern: "(?:\\$\\s?1,?000,?000|\\$\\s?1m|one\\s+million).{0,50}no\\s+(?:medical\\s+)?exam",
    classification: "QUALIFIED",
    eligibleProducts: ["iul", "mortgage_protection"],
    carrierBasis: "Carrier accelerated-underwriting products with eligible face amounts up to $1M+.",
    requiredQualifierText: "High-face no-exam coverage uses accelerated underwriting and is subject to carrier eligibility, health history, age, state, and available product limits.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
    claimId: "one_million_no_exam", requiredCapabilities: ["face_amount:1000000", "medical_exam:not_required"], riskLevel: "high",
  },
  {
    claimText: "Coverage Up To $50,000",
    pattern: "coverage\\s+up\\s+to\\s+\\$\\s?50,?000",
    classification: "QUALIFIED",
    eligibleProducts: ["final_expense"],
    carrierBasis: "Final-expense face amounts available from supported carriers, subject to underwriting.",
    requiredQualifierText: "Coverage amounts and eligibility vary by carrier, state, age, and health.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
    claimId: "coverage_up_to_50000", requiredCapabilities: ["face_amount:50000"], riskLevel: "high",
  },
  {
    claimText: "Locked-In Rates",
    pattern: "(?:locked[ -]?in|guaranteed)\\s+rates?",
    classification: "QUALIFIED",
    eligibleProducts: ["final_expense", "mortgage_protection", "veteran", "trucker"],
    carrierBasis: "Eligible level-premium permanent life products.",
    requiredQualifierText: "Level premiums are available only on eligible policies and remain subject to policy terms and carrier approval.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
    claimId: "rates_never_increase", requiredCapabilities: ["premium:level_guaranteed"], riskLevel: "high",
  },
  {
    claimText: "Tax-Advantaged",
    pattern: "tax[ -]?(?:advantaged|free|deferred)",
    classification: "QUALIFIED",
    eligibleProducts: ["iul"],
    carrierBasis: "Life-insurance tax treatment when policies are properly structured and remain in force.",
    requiredQualifierText: "Tax treatment depends on individual circumstances and policy structure; consult a qualified tax professional. CoveCRM and its agents do not provide tax advice.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
    claimId: "tax_advantaged", requiredCapabilities: ["tax:approved_language"], riskLevel: "high",
  },
];

function canonicalClaim(input: {
  id: string; text: string; pattern: string; products: string[]; capabilities: string[]; qualifier?: string;
}): RegisteredClaim {
  return {
    claimId: input.id,
    claimText: input.text,
    canonicalMeaning: input.text,
    pattern: input.pattern,
    classification: input.qualifier ? "QUALIFIED" : "CLEAN",
    eligibleProducts: input.products,
    carrierBasis: "Requires a current carrier/product capability record and Cove compliance approval evidence.",
    requiredQualifierText: input.qualifier || "",
    requiredDisclosure: input.qualifier || "",
    states: ["*"],
    version: "canonical-2026-08-v1",
    effectiveVersion: "canonical-2026-08-v1",
    expiresAt: FAR_FUTURE,
    approvedBy: "system_seed_v1",
    approvalSource: "unapproved-canonical-registry",
    requiredCapabilities: input.capabilities,
    riskLevel: "high",
  };
}

export const ADDITIONAL_META_CLAIMS: RegisteredClaim[] = [
  canonicalClaim({ id: "whole_life", text: "Whole Life", pattern: "\\bwhole\\s+life\\b", products: ["final_expense", "veteran", "trucker"], capabilities: ["product:whole_life"] }),
  canonicalClaim({ id: "immediate_coverage", text: "Immediate Coverage", pattern: "(?:immediate|day\\s+one|first\\s+day)\\s+(?:coverage|benefit)", products: ["final_expense"], capabilities: ["waiting_period:none"] }),
  ...[25_000, 35_000, 100_000, 1_000_000, 2_000_000].map((amount) => canonicalClaim({
    id: `coverage_up_to_${amount}`, text: `Coverage Up To $${amount.toLocaleString("en-US")}`,
    pattern: `(?:coverage|benefit|face amount).{0,24}(?:up\\s+to|max(?:imum)?|as\\s+much\\s+as).{0,10}\\$\\s?${amount.toLocaleString("en-US").replace(/,/g, ",?")}`,
    products: amount <= 100_000 ? ["final_expense", "veteran", "trucker"] : ["iul", "mortgage_protection", "veteran", "trucker"],
    capabilities: [`face_amount:${amount}`], qualifier: "Coverage amounts and eligibility vary by carrier, state, age, health, and underwriting.",
  })),
  canonicalClaim({ id: "no_blood_work", text: "No Blood Work", pattern: "no\\s+blood\\s+work", products: ["final_expense", "iul", "mortgage_protection", "veteran", "trucker"], capabilities: ["medical_exam:not_required"] }),
  canonicalClaim({ id: "guaranteed_acceptance", text: "Guaranteed Acceptance", pattern: "guaranteed\\s+acceptance", products: ["final_expense"], capabilities: ["underwriting:guaranteed_acceptance"] }),
  canonicalClaim({ id: "preexisting_accepted", text: "Pre-existing Conditions Accepted", pattern: "pre[ -]?existing\\s+conditions?.{0,20}(?:accepted|covered|okay)", products: ["final_expense"], capabilities: ["underwriting:preexisting_accepted"] }),
  canonicalClaim({ id: "benefits_never_decrease", text: "Benefits Never Decrease", pattern: "benefits?\\s+(?:never|will\\s+not|won't)\\s+(?:decrease|go\\s+down|change)", products: ["final_expense", "veteran", "trucker"], capabilities: ["benefit:level_guaranteed"] }),
  canonicalClaim({ id: "living_benefits", text: "Living Benefits", pattern: "\\bliving\\s+benefits?\\b", products: ["iul", "mortgage_protection"], capabilities: ["benefit:living"] }),
  canonicalClaim({ id: "tax_free_death_benefit", text: "Tax-Free Death Benefit", pattern: "tax[ -]?free\\s+death\\s+benefit", products: ["iul"], capabilities: ["tax:death_benefit_language"] }),
  canonicalClaim({ id: "tax_free_retirement", text: "Tax-Free Retirement", pattern: "tax[ -]?free\\s+(?:income|retirement|withdrawals?)", products: ["iul"], capabilities: ["tax:retirement_language"], qualifier: "Tax treatment depends on policy structure and individual circumstances; consult a qualified tax professional." }),
  canonicalClaim({ id: "market_downside_floor", text: "Market Downside/Floor", pattern: "market.{0,30}(?:downside|floor|zero\\s+floor|can't\\s+lose|no\\s+loss)", products: ["iul"], capabilities: ["index:floor_language"], qualifier: "Index crediting is subject to policy terms, caps, participation rates, costs, and a floor; it is not a direct market investment." }),
  canonicalClaim({ id: "premium_example", text: "Premium/Price Example", pattern: "(?:as\\s+low\\s+as|starting\\s+at|only)\\s+\\$\\s?\\d[\\d,]*(?:\\.\\d{1,2})?", products: ["final_expense", "iul", "mortgage_protection", "veteran", "trucker"], capabilities: ["premium:approved_example"], qualifier: "Example premiums are not quotes; actual rates depend on age, state, health, carrier, product, and underwriting." }),
  canonicalClaim({ id: "approval_speed", text: "Approval Speed", pattern: "(?:approved|approval).{0,20}(?:minutes?|hours?|same\\s+day|instant|fast)", products: ["final_expense", "iul", "mortgage_protection", "veteran", "trucker"], capabilities: ["approval_speed:approved"] }),
  canonicalClaim({ id: "government_comparison", text: "VA/Government Benefit Comparison", pattern: "(?:va|government).{0,30}(?:benefit|program|coverage|approved|endorsed)", products: ["veteran"], capabilities: ["government_comparison:approved"], qualifier: "This is not affiliated with or endorsed by the U.S. Department of Veterans Affairs, the U.S. military, or any government agency." }),
  canonicalClaim({ id: "statistical_risk", text: "Statistical Risk Claim", pattern: "\\b\\d+(?:\\.\\d+)?%\\s+(?:of|more|less|risk|chance|families|people)", products: ["final_expense", "iul", "mortgage_protection", "veteran", "trucker"], capabilities: ["statistics:approved_source"] }),
];

export const ALL_META_CLAIMS: RegisteredClaim[] = [...DEFAULT_META_CLAIMS, ...ADDITIONAL_META_CLAIMS];

const RISKY_PATTERNS = [
  /\bwhole\s+life\b/i,
  /(?:coverage|benefit|face amount).{0,30}(?:up\s+to|max(?:imum)?|as\s+much\s+as).{0,12}\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|million|thousand)?/i,
  /no\s+(?:medical\s+)?exam/i,
  /no\s+(?:two|2)[ -]?year\s+wait/i,
  /(?:locked[ -]?in|guaranteed)\s+rates?/i,
  /tax[ -]?(?:advantaged|free|deferred)/i,
  /(?:immediate|day\s+one|first\s+day)\s+(?:coverage|benefit)/i,
  /(?:rates?|premiums?)\s+(?:never|will\s+not|won't)\s+(?:increase|go\s+up|change)/i,
  /(?:as\s+low\s+as|starting\s+at|only)\s+\$\s?\d[\d,]*(?:\.\d{1,2})?/i,
  /(?:funeral|burial).{0,30}\$\s?\d[\d,]*(?:\.\d{1,2})?/i,
  /\bno\s+blood\s+work\b/i,
  /\bguaranteed\s+acceptance\b/i,
  /pre[ -]?existing\s+conditions?.{0,20}(?:accepted|covered|okay)/i,
  /benefits?\s+(?:never|will\s+not|won't)\s+(?:decrease|go\s+down|change)/i,
  /\bliving\s+benefits?\b/i,
  /tax[ -]?free\s+death\s+benefit/i,
  /tax[ -]?free\s+(?:income|retirement|withdrawals?)/i,
  /market.{0,30}(?:downside|floor|zero\s+floor|can't\s+lose|no\s+loss)/i,
  /(?:approved|approval).{0,20}(?:minutes?|hours?|same\s+day|instant|fast)/i,
  /(?:va|government).{0,30}(?:benefit|program|coverage|approved|endorsed)/i,
  /\b\d+(?:\.\d+)?%\s+(?:of|more|less|risk|chance|families|people)/i,
];

function capabilityTokens(capability: Record<string, any> | null | undefined): Set<string> {
  if (!capability) return new Set();
  const result = new Set<string>();
  if (capability.medicalExamRequirement === "not_required") result.add("medical_exam:not_required");
  if (Number(capability.faceAmountMax) > 0) {
    for (const amount of [25_000, 35_000, 50_000, 100_000, 1_000_000, 2_000_000]) {
      if (Number(capability.faceAmountMax) >= amount) result.add(`face_amount:${amount}`);
    }
  }
  if ((capability.waitingPeriodRules || []).some((value: any) => /none|no wait|immediate/i.test(String(value)))) result.add("waiting_period:none");
  if ((capability.premiumGuarantees || []).some((value: any) => /level|never increase|guaranteed/i.test(String(value)))) result.add("premium:level_guaranteed");
  if ((capability.taxTreatmentCapabilities || []).length > 0) result.add("tax:approved_language");
  for (const value of [
    ...(capability.immediateBenefitRules || []), ...(capability.gradedBenefitRules || []),
    ...(capability.benefitGuarantees || []), ...(capability.livingBenefits || []),
    ...(capability.approvalSpeedCapabilities || []), ...(capability.otherCapabilities || []),
  ]) result.add(String(value).trim().toLowerCase());
  return result;
}

export async function ensureDefaultMetaClaims(): Promise<void> {
  await Promise.all(ALL_META_CLAIMS.map((claim) =>
    MetaClaimRegistry.findOneAndUpdate(
      { claimText: claim.claimText, version: claim.version },
      { $setOnInsert: claim },
      { upsert: true, new: true }
    )
  ));
}

export function buildLandingPageSnapshot(config: Record<string, any>): string {
  return [
    config.headline,
    config.subheadline,
    ...(Array.isArray(config.benefitBullets) ? config.benefitBullets : []),
    config.ctaStrip,
    config.disclaimerText,
    ...(Array.isArray(config.qualifierTexts) ? config.qualifierTexts : []),
  ].map((value) => String(value || "").trim()).filter(Boolean).join("\n");
}

export function requiredQualifierTextsForCreative(creativeText: string, claims: RegisteredClaim[]): string[] {
  return Array.from(new Set(claims
    .filter((claim) => claim.classification === "QUALIFIED" && new RegExp(claim.pattern, "i").test(creativeText))
    .map((claim) => String(claim.requiredQualifierText || "").trim())
    .filter(Boolean)));
}

export function applyTenantClaimApprovals(
  claims: RegisteredClaim[],
  approvals: Array<Record<string, any>>,
  now: Date = new Date()
): RegisteredClaim[] {
  const approvalByClaim = new Map(
    approvals
      .filter((approval) => !approval.revokedAt && new Date(approval.expiresAt).getTime() > now.getTime())
      .map((approval) => [`${String(approval.claimText)}::${String(approval.claimVersion)}`, approval])
  );
  return claims.map((claim) => {
    const approval = approvalByClaim.get(`${claim.claimText}::${claim.version}`);
    if (!approval) return claim;
    return {
      ...claim,
      eligibleProducts: Array.isArray(approval.eligibleProducts) ? approval.eligibleProducts : claim.eligibleProducts,
      states: Array.isArray(approval.states) ? approval.states : claim.states,
      carrierBasis: String(approval.carrierBasis || claim.carrierBasis),
      approvalEvidence: String(approval.approvalEvidence || ""),
      approvedBy: String(approval.approvedBy || ""),
      approvedAt: approval.approvedAt,
      expiresAt: approval.expiresAt,
    };
  });
}

export function evaluateCreativeClaims(input: {
  creativeText: string;
  leadType: string;
  states: string[];
  landingPageSnapshot: string;
  claims: RegisteredClaim[];
  productCapability?: Record<string, any> | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  const matched = input.claims.filter((claim) => new RegExp(claim.pattern, "i").test(input.creativeText));
  const warnings: string[] = [];
  const blockers: string[] = [];
  const addIssue = (message: string) => {
    warnings.push(message);
    blockers.push(message);
  };
  const availableCapabilities = capabilityTokens(input.productCapability);
  for (const claim of matched) {
    if (!String(claim.approvedBy || "").trim() || /^system[_ -]/i.test(String(claim.approvedBy))) {
      addIssue(`Claim has no current CoveCRM approval record: ${claim.claimText}`);
    }
    if (!String(claim.carrierBasis || "").trim()) {
      addIssue(`Claim is missing stored carrier substantiation: ${claim.claimText}`);
    }
    if (!String(claim.approvalEvidence || "").trim() && claim.approvedBy !== "compliance") {
      addIssue(`Claim approval has no stored evidence: ${claim.claimText}`);
    }
    if (new Date(claim.expiresAt).getTime() <= now.getTime()) {
      addIssue(`Claim registry entry is expired: ${claim.claimText}`);
    }
    if (!claim.eligibleProducts.includes(input.leadType)) {
      addIssue(`Claim is not registered for ${input.leadType}: ${claim.claimText}`);
    }
    const allowedStates = new Set(claim.states || []);
    if (!allowedStates.has("*") && input.states.some((state) => !allowedStates.has(state))) {
      addIssue(`Claim is not registered for every selected state: ${claim.claimText}`);
    }
    for (const requirement of claim.requiredCapabilities || []) {
      if (!availableCapabilities.has(requirement)) {
        addIssue(`Selected product capability does not substantiate ${claim.claimText} (${requirement}).`);
      }
    }
    if (claim.classification === "QUALIFIED") {
      const qualifier = String(claim.requiredQualifierText || "").trim();
      if (!qualifier || !input.landingPageSnapshot.includes(qualifier)) {
        addIssue(`Qualified claim is missing its rendered landing-page disclosure: ${qualifier || claim.claimText}`);
      }
    }
  }
  const unmatchedRisky = RISKY_PATTERNS.find((pattern) => {
    if (!pattern.test(input.creativeText)) return false;
    const source = pattern.source;
    if (source.includes("\\$")) return !matched.some((claim) => claim.claimText.includes("$"));
    if (source.includes("exam")) return !matched.some((claim) => /exam/i.test(claim.claimText));
    if (source.includes("year")) return !matched.some((claim) => /wait/i.test(claim.claimText));
    if (source.includes("rates")) return !matched.some((claim) => /rate/i.test(claim.claimText));
    if (source.includes("tax")) return !matched.some((claim) => /tax/i.test(claim.claimText));
    if (source.includes("immediate") || source.includes("day\\s")) return !matched.some((claim) => /immediate|day one/i.test(claim.claimText));
    if (source.includes("premiums") || source.includes("increase")) return !matched.some((claim) => /premium|increase/i.test(claim.claimText));
    if (source.includes("starting") || source.includes("as\\s+low")) return !matched.some((claim) => /premium|rate/i.test(claim.claimText));
    if (source.includes("funeral") || source.includes("burial")) return !matched.some((claim) => /funeral|burial/i.test(claim.claimText));
    return true;
  });
  if (unmatchedRisky) {
    const sample = input.creativeText.match(unmatchedRisky)?.[0] || "risky claim";
    addIssue(`Unregistered claim detected: ${sample}`);
  }
  return {
    matchedClaims: matched,
    qualifierTexts: Array.from(new Set(matched
      .filter((claim) => claim.classification === "QUALIFIED")
      .map((claim) => String(claim.requiredQualifierText || "").trim())
      .filter(Boolean))),
    warnings,
    blockers: Array.from(new Set(blockers)),
    launchAllowed: blockers.length === 0,
  };
}
