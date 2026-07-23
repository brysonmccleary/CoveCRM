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
  },
  {
    claimText: "No Medical Exam",
    pattern: "no\\s+(?:medical\\s+)?exam",
    classification: "CLEAN",
    eligibleProducts: ["final_expense", "iul", "mortgage_protection", "veteran", "trucker"],
    carrierBasis: "Simplified-issue products that do not require a paramedical examination.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
  },
  {
    claimText: "$1,000,000 No Exam",
    pattern: "(?:\\$\\s?1,?000,?000|\\$\\s?1m|one\\s+million).{0,50}no\\s+(?:medical\\s+)?exam",
    classification: "QUALIFIED",
    eligibleProducts: ["iul", "mortgage_protection"],
    carrierBasis: "Carrier accelerated-underwriting products with eligible face amounts up to $1M+.",
    requiredQualifierText: "High-face no-exam coverage uses accelerated underwriting and is subject to carrier eligibility, health history, age, state, and available product limits.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
  },
  {
    claimText: "Coverage Up To $50,000",
    pattern: "coverage\\s+up\\s+to\\s+\\$\\s?50,?000",
    classification: "QUALIFIED",
    eligibleProducts: ["final_expense"],
    carrierBasis: "Final-expense face amounts available from supported carriers, subject to underwriting.",
    requiredQualifierText: "Coverage amounts and eligibility vary by carrier, state, age, and health.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
  },
  {
    claimText: "Locked-In Rates",
    pattern: "(?:locked[ -]?in|guaranteed)\\s+rates?",
    classification: "QUALIFIED",
    eligibleProducts: ["final_expense", "mortgage_protection", "veteran", "trucker"],
    carrierBasis: "Eligible level-premium permanent life products.",
    requiredQualifierText: "Level premiums are available only on eligible policies and remain subject to policy terms and carrier approval.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
  },
  {
    claimText: "Tax-Advantaged",
    pattern: "tax[ -]?(?:advantaged|free|deferred)",
    classification: "QUALIFIED",
    eligibleProducts: ["iul"],
    carrierBasis: "Life-insurance tax treatment when policies are properly structured and remain in force.",
    requiredQualifierText: "Tax treatment depends on individual circumstances and policy structure; consult a qualified tax professional. CoveCRM and its agents do not provide tax advice.",
    states: ["*"], version: "seed-2026-07-v1", expiresAt: FAR_FUTURE, approvedBy: "system_seed_v1",
  },
];

const RISKY_PATTERNS = [
  /(?:coverage|benefit|face amount).{0,30}(?:up\s+to|max(?:imum)?|as\s+much\s+as).{0,12}\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|million|thousand)?/i,
  /no\s+(?:medical\s+)?exam/i,
  /no\s+(?:two|2)[ -]?year\s+wait/i,
  /(?:locked[ -]?in|guaranteed)\s+rates?/i,
  /tax[ -]?(?:advantaged|free|deferred)/i,
  /(?:immediate|day\s+one|first\s+day)\s+(?:coverage|benefit)/i,
  /(?:rates?|premiums?)\s+(?:never|will\s+not|won't)\s+(?:increase|go\s+up|change)/i,
  /(?:as\s+low\s+as|starting\s+at|only)\s+\$\s?\d[\d,]*(?:\.\d{1,2})?/i,
  /(?:funeral|burial).{0,30}\$\s?\d[\d,]*(?:\.\d{1,2})?/i,
];

export async function ensureDefaultMetaClaims(): Promise<void> {
  await Promise.all(DEFAULT_META_CLAIMS.map((claim) =>
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
  now?: Date;
}) {
  const now = input.now || new Date();
  const matched = input.claims.filter((claim) => new RegExp(claim.pattern, "i").test(input.creativeText));
  for (const claim of matched) {
    if (!String(claim.approvedBy || "").trim() || /^system[_ -]/i.test(String(claim.approvedBy))) {
      throw new Error(`Claim requires current carrier/compliance approval before publishing: ${claim.claimText}`);
    }
    if (!String(claim.carrierBasis || "").trim()) {
      throw new Error(`Claim is missing carrier substantiation: ${claim.claimText}`);
    }
    if (!String(claim.approvalEvidence || "").trim() && claim.approvedBy !== "compliance") {
      throw new Error(`Claim approval is missing evidence: ${claim.claimText}`);
    }
    if (new Date(claim.expiresAt).getTime() <= now.getTime()) throw new Error(`Claim registry entry expired: ${claim.claimText}`);
    if (!claim.eligibleProducts.includes(input.leadType)) throw new Error(`Claim is not registered for ${input.leadType}: ${claim.claimText}`);
    const allowedStates = new Set(claim.states || []);
    if (!allowedStates.has("*") && input.states.some((state) => !allowedStates.has(state))) {
      throw new Error(`Claim is not registered for every selected state: ${claim.claimText}`);
    }
    if (claim.classification === "QUALIFIED") {
      const qualifier = String(claim.requiredQualifierText || "").trim();
      if (!qualifier || !input.landingPageSnapshot.includes(qualifier)) {
        throw new Error(`Qualified claim requires this rendered landing-page disclosure: ${qualifier || claim.claimText}`);
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
    throw new Error(`Unregistered risky claim '${sample}'. Add a current substantiated claim registry entry before publishing.`);
  }
  return {
    matchedClaims: matched,
    qualifierTexts: Array.from(new Set(matched
      .filter((claim) => claim.classification === "QUALIFIED")
      .map((claim) => String(claim.requiredQualifierText || "").trim())
      .filter(Boolean))),
  };
}
