export type DangerousActionType =
  | "a2p_resubmission"
  | "send_support_email"
  | "twilio_number_buy"
  | "twilio_number_release"
  | "billing_change"
  | "refund"
  | "delete_leads"
  | "delete_campaigns"
  | "modify_user_subscription"
  | "change_messaging_service";

const DANGEROUS_ACTIONS = new Set<string>([
  "a2p_resubmission",
  "send_support_email",
  "twilio_number_buy",
  "twilio_number_release",
  "billing_change",
  "refund",
  "delete_leads",
  "delete_campaigns",
  "modify_user_subscription",
  "change_messaging_service",
]);

export function isDangerousAction(actionType: string) {
  return DANGEROUS_ACTIONS.has(String(actionType || ""));
}

export function requiresApproval(actionType: string) {
  return isDangerousAction(actionType);
}

export function getRiskLevel(actionType: string): "low" | "medium" | "high" {
  if (isDangerousAction(actionType)) return "high";
  return "medium";
}

function envFlag(env: Record<string, any>, key: string) {
  return String(env?.[key] || "").toLowerCase() === "true";
}

function envNumber(env: Record<string, any>, key: string, fallback: number) {
  const value = Number(env?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function canAutoExecuteA2PFix(args: {
  classification: string;
  confidence: number;
  attempts: number;
  env?: Record<string, any>;
  missingInfoNeeded?: string[];
  complianceWarnings?: Array<{ severity?: string; message?: string }>;
  correctedPayloadValid?: boolean;
}) {
  const env = args.env || process.env;
  const minConfidence = envNumber(env, "AI_A2P_AUTOFIX_MIN_CONFIDENCE", 0.85);
  const maxAttempts = envNumber(env, "AI_A2P_AUTOFIX_MAX_ATTEMPTS", 1);
  const hasHighWarning = (args.complianceWarnings || []).some(
    (warning) => String(warning?.severity || "").toLowerCase() === "high"
  );

  const allowed =
    envFlag(env, "AI_A2P_AUTOFIX_ENABLED") &&
    envFlag(env, "A2P_AUTO_RESUBMIT_ENABLED") &&
    args.classification === "simple" &&
    Number(args.confidence || 0) >= minConfidence &&
    Number(args.attempts || 0) < maxAttempts &&
    !(args.missingInfoNeeded || []).length &&
    !hasHighWarning &&
    args.correctedPayloadValid === true;

  return {
    allowed,
    minConfidence,
    maxAttempts,
    reasons: [
      !envFlag(env, "AI_A2P_AUTOFIX_ENABLED") ? "AI_A2P_AUTOFIX_ENABLED is not true" : "",
      !envFlag(env, "A2P_AUTO_RESUBMIT_ENABLED") ? "A2P_AUTO_RESUBMIT_ENABLED is not true" : "",
      args.classification !== "simple" ? "classification is not simple" : "",
      Number(args.confidence || 0) < minConfidence ? "confidence below threshold" : "",
      Number(args.attempts || 0) >= maxAttempts ? "max attempts reached" : "",
      (args.missingInfoNeeded || []).length ? "missing user information required" : "",
      hasHighWarning ? "high severity compliance warning present" : "",
      args.correctedPayloadValid !== true ? "corrected payload failed validation" : "",
    ].filter(Boolean),
  };
}

