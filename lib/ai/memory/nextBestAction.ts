export function getSuggestedTaskLabel(nextBestAction?: string | null) {
  const action = String(nextBestAction || "").trim();
  if (!action) return "";

  const lowered = action.toLowerCase();
  if (lowered.includes("call")) return "Suggested task: Call this lead";
  if (lowered.includes("follow up")) return "Suggested task: Follow up with this lead";
  if (lowered.includes("text")) return "Suggested task: Send a text follow-up";
  if (lowered.includes("book")) return "Suggested task: Try to book an appointment";
  return "";
}
