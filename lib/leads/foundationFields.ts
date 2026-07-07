import { timezoneForState } from "@/lib/leads/stateTimezone";

export const SOLD_STATUS_VALUES = new Set(["sold", "sale"]);

export function isSoldStatus(status?: string | null): boolean {
  return SOLD_STATUS_VALUES.has(String(status || "").trim().toLowerCase());
}

export function buildSoldAtTransitionSet({
  nextStatus,
  previousStatus,
  existingSoldAt,
  now = new Date(),
}: {
  nextStatus?: string | null;
  previousStatus?: string | null;
  existingSoldAt?: Date | string | null;
  now?: Date;
}): Record<string, any> {
  if (!isSoldStatus(nextStatus)) return {};
  if (isSoldStatus(previousStatus)) return {};
  if (existingSoldAt) return {};
  return { soldAt: now, soldAtApproximate: false };
}

export function buildOutboundContactAttemptUpdate(at = new Date()) {
  return {
    $inc: { contactAttempts: 1 },
    $set: { lastContactedAt: at },
  };
}

export async function recordOutboundTouch(args: {
  leadId: any;
  userEmail: string;
}): Promise<void> {
  const leadId = args.leadId;
  const userEmail = String(args.userEmail || "").toLowerCase();
  try {
    if (!leadId || !userEmail) return;
    const Lead = (await import("@/models/Lead")).default as any;
    const at = new Date();
    await Lead.updateOne(
      { _id: leadId, userEmail },
      buildOutboundContactAttemptUpdate(at),
    ).exec();
  } catch (err: any) {
    console.warn("[lead-foundations] touch failed", {
      leadId,
      userEmail,
      error: err?.message || String(err),
    });
  }
}

export function deriveLeadTimezone(fields: Record<string, any>): string {
  return timezoneForState(fields.State ?? fields.state ?? "");
}

export function withDerivedTimezone<T extends Record<string, any>>(fields: T): T {
  const timezone = fields.timezone || deriveLeadTimezone(fields);
  return timezone ? ({ ...fields, timezone } as T) : fields;
}

export function getUpdateStateValue(update: any): any {
  if (!update || Array.isArray(update)) return undefined;
  if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, "State")) {
    return update.$set.State;
  }
  if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, "state")) {
    return update.$set.state;
  }
  if (Object.prototype.hasOwnProperty.call(update, "State")) return update.State;
  if (Object.prototype.hasOwnProperty.call(update, "state")) return update.state;
  return undefined;
}

export function applyTimezoneToUpdate(update: any): any {
  const stateValue = getUpdateStateValue(update);
  if (stateValue === undefined) return update;
  const timezone = timezoneForState(stateValue);
  if (!timezone) return update;
  update.$set = { ...(update.$set || {}), timezone };
  return update;
}

export function deriveInteractionContactFields(interactionHistory: any[] = []) {
  let contactAttempts = 0;
  let lastContactedAt: Date | null = null;

  for (const entry of interactionHistory) {
    const type = String(entry?.type || entry?.direction || "").toLowerCase();
    if (type !== "outbound") continue;
    contactAttempts += 1;
    const rawDate = entry?.date || entry?.createdAt || entry?.timestamp;
    const date = rawDate ? new Date(rawDate) : null;
    if (date && !Number.isNaN(date.getTime())) {
      if (!lastContactedAt || date > lastContactedAt) lastContactedAt = date;
    }
  }

  return { contactAttempts, lastContactedAt };
}
