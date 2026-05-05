export type SupportTaskKind =
  | "crm_support_chat"
  | "admin_diagnosis"
  | "bulk_summary"
  | "low_risk_cleanup"
  | "premium_or_unclear";

export type SupportTaskClassification = {
  task: SupportTaskKind;
  route: "default" | "kimi" | "deepseek" | "openai";
  reason: string;
};

export function classifySupportTask(message: string, pageContext?: string): SupportTaskClassification {
  const text = String(message || "").toLowerCase();
  const context = String(pageContext || "").toLowerCase();

  if (
    /\b(admin|diagnos(e|is|tic)|debug|why is|provider health|system health|integration status)\b/.test(text) ||
    context.includes("admin")
  ) {
    return {
      task: "admin_diagnosis",
      route: "kimi",
      reason: "diagnostic/admin-style support request",
    };
  }

  if (/\b(summarize|summary|recap|digest|overview|compress)\b/.test(text)) {
    return {
      task: "bulk_summary",
      route: "deepseek",
      reason: "summary-style request",
    };
  }

  if (/\b(clean up|cleanup|rewrite|format|organize|tidy|normalize)\b/.test(text)) {
    return {
      task: "low_risk_cleanup",
      route: "deepseek",
      reason: "low-risk cleanup request",
    };
  }

  if (/\b(legal|compliance advice|policy advice|quote|premium|unclear|not sure|complicated)\b/.test(text)) {
    return {
      task: "premium_or_unclear",
      route: "openai",
      reason: "premium, sensitive, or unclear request",
    };
  }

  return {
    task: "crm_support_chat",
    route: "default",
    reason: "default CRM support chat",
  };
}

