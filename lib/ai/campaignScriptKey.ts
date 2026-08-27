export const SPANISH_CAMPAIGN_SCRIPT_KEYS = [
  "spanish_final_expense",
  "spanish_mortgage",
  "spanish_iul",
] as const;

export function resolveCampaignAiScriptKey(leadType: string, audienceSegment: string): string {
  if (audienceSegment === "spanish") {
    if (leadType === "mortgage_protection") return "spanish_mortgage";
    if (leadType === "iul") return "spanish_iul";
    return "spanish_final_expense";
  }
  if (audienceSegment === "veteran") {
    if (leadType === "mortgage_protection") return "veteran_mortgage";
    if (leadType === "iul") return "veteran_iul";
    return "veteran_leads";
  }
  if (audienceSegment === "trucker") {
    if (leadType === "mortgage_protection") return "trucker_mortgage";
    if (leadType === "iul") return "trucker_iul";
    return "trucker_leads";
  }
  if (leadType === "mortgage_protection") return "mortgage_protection";
  if (leadType === "iul") return "iul_cash_value";
  if (leadType === "veteran") return "veteran_leads";
  if (leadType === "trucker") return "trucker_leads";
  return "final_expense";
}
