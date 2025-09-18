// utils/checkCallTime.ts
import { DateTime } from "luxon";
import { resolveLeadTimezone, type LeadLike } from "./leadTimezone";

/** Core window: 8:00 <= local time < 21:00 */
export const QUIET_HOURS = { startHour: 8, endHour: 21 };

/** Existing API (string tz). */
export function isCallAllowed(timezone: string): boolean {
  const now = DateTime.now().setZone(timezone || "UTC");
  const hour = now.hour;
  return hour >= QUIET_HOURS.startHour && hour < QUIET_HOURS.endHour;
}

/** New helper: decide for a lead; returns {allowed, zone} */
export function isCallAllowedForLead(lead: LeadLike): { allowed: boolean; zone: string | null } {
  const zone = resolveLeadTimezone(lead);
  if (!zone) {
    // Unknown timezone: allow call (client can choose to allow but label as "unknown tz")
    return { allowed: true, zone: null };
  }
  return { allowed: isCallAllowed(zone), zone };
}

/** Optional pretty string for debug/status lines. */
export function localTimeString(zone: string | null): string {
  if (!zone) return "(tz unknown)";
  const now = DateTime.now().setZone(zone);
  return `${now.toFormat("ccc L/d @ h:mm a")} ${now.offsetNameShort}`;
}
