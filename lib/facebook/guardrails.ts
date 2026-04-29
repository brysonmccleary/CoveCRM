import { normalizeStateCodes } from "@/lib/facebook/geo/usStates";

export type PerformanceGuardrailDecision =
  | "flag_high_cpl"
  | "suggest_refresh"
  | "allow_duplicate"
  | "monitor";

export function validateStates(states: unknown): string[] {
  const normalized = normalizeStateCodes(states);
  if (!normalized.length) {
    throw new Error("Licensed states required");
  }
  return normalized;
}

export function evaluatePerformanceGuardrails(input: {
  spend?: number;
  leads?: number;
  cpl?: number;
  targetCpl?: number;
  performanceClass?: string | null;
}): {
  decision: PerformanceGuardrailDecision;
  message: string;
  allowDuplicate: boolean;
} {
  const spend = Number(input.spend || 0);
  const leads = Number(input.leads || 0);
  const cpl = Number(input.cpl || 0);
  const targetCpl = Number(input.targetCpl || 25);

  if (spend >= Math.max(targetCpl * 2, 50) && leads === 0) {
    return {
      decision: "suggest_refresh",
      message: "Spend is live with no leads yet. Refresh the creative before scaling.",
      allowDuplicate: false,
    };
  }

  if (cpl > 0 && cpl > targetCpl * 1.5) {
    return {
      decision: "flag_high_cpl",
      message: "CPL is above target. Refresh creative or pause before adding budget.",
      allowDuplicate: false,
    };
  }

  if (input.performanceClass === "SCALE" || (cpl > 0 && cpl <= targetCpl && leads >= 5)) {
    return {
      decision: "allow_duplicate",
      message: "Performance is strong enough to duplicate for a controlled test.",
      allowDuplicate: true,
    };
  }

  return {
    decision: "monitor",
    message: "Keep monitoring before making changes.",
    allowDuplicate: false,
  };
}
