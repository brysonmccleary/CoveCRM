export function hasMetaStatusDrift(coveStatus: unknown, metaEffectiveStatus: unknown): boolean {
  const cove = String(coveStatus || "").toUpperCase();
  const meta = String(metaEffectiveStatus || "").toUpperCase();
  if (!meta || meta === "MISSING") return false;
  return (cove === "ACTIVE" && meta !== "ACTIVE") ||
    (cove === "PAUSED" && meta === "ACTIVE");
}

export function metaActionCount(insights: any, actionTypes: string[]): number {
  const actions = Array.isArray(insights?.actions) ? insights.actions : [];
  return actions
    .filter((action: any) => actionTypes.includes(String(action?.action_type || "")))
    .reduce((sum: number, action: any) => sum + Number(action?.value || 0), 0);
}
