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
  input: { vertical: CreativeVertical; state?: string; applicantAge?: number; now?: Date }
): string[] {
  const errors: string[] = [];
  const now = input.now || new Date();
  if (!capability.active) errors.push("The selected product capability is inactive.");
  if (!capability.products.includes(input.vertical)) errors.push("The selected product does not support this vertical.");
  if (capability.expiresAt && new Date(capability.expiresAt) <= now) errors.push("The selected product capability has expired.");
  if (input.state && capability.states.length > 0 && !capability.states.includes("*") && !capability.states.includes(input.state)) {
    errors.push(`The selected product is not approved for ${input.state}.`);
  }
  if (input.applicantAge != null && capability.issueAgeMin != null && input.applicantAge < capability.issueAgeMin) {
    errors.push(`The selected product is not approved for issue age ${input.applicantAge}.`);
  }
  if (input.applicantAge != null && capability.issueAgeMax != null && input.applicantAge > capability.issueAgeMax) {
    errors.push(`The selected product is not approved for issue age ${input.applicantAge}.`);
  }
  if (!capability.approvalSource.trim()) errors.push("Product capability approval evidence is missing.");
  return errors;
}

export function resolveProductCapability(input: {
  vertical: CreativeVertical;
  state?: string;
  applicantAge?: number;
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

export function formatApprovedHeroAmount(capability: ProductCapability): string | undefined {
  const amount = Number(capability.faceAmountMax);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return `$${Math.floor(amount).toLocaleString("en-US")}`;
}

export function assertApprovedHeroAmount(capability: ProductCapability, displayAmount?: string): true {
  if (!displayAmount) return true;
  const numeric = Number(displayAmount.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0 || capability.faceAmountMax == null || numeric > capability.faceAmountMax) {
    throw new Error(`Hero amount ${displayAmount} is not supported by the configured product capability.`);
  }
  return true;
}

export function getApprovedBenefitCopy(capability: ProductCapability, language: "en" | "es"): string[] {
  const result: string[] = [];
  const add = (en: string, es: string) => result.push(language === "es" ? es : en);
  if (capability.medicalExamRequirement === "not_required") add("No medical exam", "Sin examen médico");
  if ((capability.waitingPeriodRules || []).some((value) => /none|no wait|sin espera/i.test(value))) add("No waiting period", "Sin período de espera");
  if ((capability.immediateBenefitRules || []).some((value) => /immediate|day one|first day|inmedi/i.test(value))) add("Immediate benefit", "Beneficio inmediato");
  if ((capability.livingBenefits || []).length > 0) add("Living benefits", "Beneficios en vida");
  if ((capability.premiumGuarantees || []).some((value) => /level|guarantee|never increase|nivel|garant/i.test(value))) add("Premium guarantee", "Prima garantizada");
  return [...new Set(result)].slice(0, 3);
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
