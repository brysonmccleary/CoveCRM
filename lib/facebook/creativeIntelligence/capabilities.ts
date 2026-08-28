import type { CreativeVertical, ProductCapability } from "./types";

export const SAFE_GENERAL_CAPABILITY_ID = "safe-general-v1";

export function buildSafeGeneralCapability(vertical: CreativeVertical): ProductCapability {
  return {
    capabilityId: SAFE_GENERAL_CAPABILITY_ID,
    carrier: "UNCONFIGURED",
    product: "General coverage education",
    productIdentifier: "UNCONFIGURED",
    products: [vertical],
    states: [],
    issueAgeMin: null,
    issueAgeMax: null,
    faceAmountMin: null,
    faceAmountMax: null,
    waitingPeriodRules: [],
    immediateBenefitRules: [],
    gradedBenefitRules: [],
    medicalExamRequirement: "unknown",
    underwritingType: "",
    premiumGuarantees: [],
    benefitGuarantees: [],
    livingBenefits: [],
    taxTreatmentCapabilities: [],
    approvalSpeedCapabilities: [],
    otherCapabilities: [],
    effectiveDate: "2026-08-28",
    approvalSource: "system-safe-default",
    approvalMetadata: { aggressiveClaimsAllowed: false },
    active: true,
  };
}

export function validateProductCapability(
  capability: ProductCapability,
  input: { vertical: CreativeVertical; state?: string; now?: Date }
): string[] {
  const errors: string[] = [];
  const now = input.now || new Date();
  if (!capability.active) errors.push("The selected product capability is inactive.");
  if (!capability.products.includes(input.vertical)) errors.push("The selected product does not support this vertical.");
  if (capability.expiresAt && new Date(capability.expiresAt) <= now) errors.push("The selected product capability has expired.");
  if (input.state && capability.states.length > 0 && !capability.states.includes("*") && !capability.states.includes(input.state)) {
    errors.push(`The selected product is not approved for ${input.state}.`);
  }
  if (!capability.approvalSource.trim()) errors.push("Product capability approval evidence is missing.");
  return errors;
}

export function resolveProductCapability(input: {
  vertical: CreativeVertical;
  state?: string;
  capability?: ProductCapability | null;
}): { capability: ProductCapability; source: "configured_product" | "safe_general"; errors: string[] } {
  if (!input.capability) {
    return { capability: buildSafeGeneralCapability(input.vertical), source: "safe_general", errors: [] };
  }
  const errors = validateProductCapability(input.capability, input);
  if (errors.length > 0) {
    return { capability: buildSafeGeneralCapability(input.vertical), source: "safe_general", errors };
  }
  return { capability: input.capability, source: "configured_product", errors: [] };
}

export function productCapabilitySupports(capability: ProductCapability, requirement: string): boolean {
  const values = [
    ...(capability.waitingPeriodRules || []), ...(capability.immediateBenefitRules || []),
    ...(capability.gradedBenefitRules || []), ...(capability.premiumGuarantees || []),
    ...(capability.benefitGuarantees || []), ...(capability.livingBenefits || []),
    ...(capability.taxTreatmentCapabilities || []), ...(capability.approvalSpeedCapabilities || []),
    ...(capability.otherCapabilities || []),
  ].map((value) => String(value).trim().toLowerCase());
  return values.includes(requirement.toLowerCase());
}
