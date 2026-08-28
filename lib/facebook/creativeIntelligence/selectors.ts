import type { CreativeVertical, ProductCapability, SelectorContract, SelectorType } from "./types";

function ageOptions(capability: ProductCapability): string[] {
  const min = capability.issueAgeMin;
  const max = capability.issueAgeMax;
  if (min == null || max == null || min > max) return [];
  const options: string[] = [];
  let cursor = min;
  while (cursor <= max && options.length < 5) {
    const end = Math.min(max, cursor + 9);
    options.push(`${cursor}–${end}`);
    cursor = end + 1;
  }
  return options;
}

function coverageOptions(capability: ProductCapability): string[] {
  const min = capability.faceAmountMin;
  const max = capability.faceAmountMax;
  if (min == null || max == null || min > max) return [];
  const candidates = [10_000, 25_000, 35_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000]
    .filter((amount) => amount >= min && amount <= max);
  return candidates.slice(0, 5).map((amount) => `$${amount.toLocaleString("en-US")}`);
}

export function buildSelectorContract(input: {
  vertical: CreativeVertical;
  requestedType?: SelectorType;
  capability: ProductCapability;
}): SelectorContract {
  const requested = input.requestedType || (input.vertical === "mortgage_protection" ? "mortgage_balance" : input.vertical === "trucker" ? "occupation" : "age_range");
  const age = ageOptions(input.capability);
  const coverage = coverageOptions(input.capability);

  if (requested === "age_range" && age.length > 0) {
    return { selectorId: "issue_age", type: "age_range", label: "Select your age range", options: age, funnelStepId: "creative_selector_issue_age", required: true, eligibilityRepresentation: true, source: "product_capability" };
  }
  if (requested === "coverage_amount" && coverage.length > 0) {
    return { selectorId: "coverage_amount", type: "coverage_amount", label: "What coverage would you like to review?", options: coverage, funnelStepId: "creative_selector_coverage_amount", required: true, eligibilityRepresentation: true, source: "product_capability" };
  }
  if (requested === "military_status" || input.vertical === "veteran") {
    return { selectorId: "military_status", type: "military_status", label: "Who are you reviewing options for?", options: ["Veteran", "Active duty", "Spouse or family"], funnelStepId: "creative_selector_military_status", required: true, eligibilityRepresentation: false, source: "vertical_configuration" };
  }
  if (requested === "mortgage_balance" || input.vertical === "mortgage_protection") {
    return { selectorId: "mortgage_priority", type: "mortgage_balance", label: "What would you like to protect?", options: ["My home", "My family's monthly payment", "Both"], funnelStepId: "creative_selector_mortgage_priority", required: true, eligibilityRepresentation: false, source: "safe_default" };
  }
  if (requested === "occupation" || input.vertical === "trucker") {
    return { selectorId: "driver_status", type: "occupation", label: "Which best describes you?", options: ["Owner-operator", "Company driver", "Other professional driver"], funnelStepId: "creative_selector_driver_status", required: true, eligibilityRepresentation: false, source: "vertical_configuration" };
  }
  return { selectorId: "coverage_priority", type: "product_qualifier", label: "What matters most to you?", options: ["Protecting family", "Planning ahead", "Understanding my options"], funnelStepId: "creative_selector_coverage_priority", required: true, eligibilityRepresentation: false, source: "safe_default" };
}

export function selectorToFunnelStep(selector: SelectorContract) {
  return {
    id: selector.funnelStepId,
    type: "choice" as const,
    title: selector.label,
    options: [...selector.options],
    required: selector.required,
  };
}

export function assertSelectorFunnelConsistency(selector: SelectorContract, step: Record<string, any>) {
  const funnelOptions = Array.isArray(step?.options)
    ? step.options.map((option: any) => String(option?.label ?? option?.value ?? option))
    : [];
  if (step?.id !== selector.funnelStepId || JSON.stringify(funnelOptions) !== JSON.stringify(selector.options)) {
    throw new Error("Creative selector and funnel qualification options do not match exactly.");
  }
  return true;
}
