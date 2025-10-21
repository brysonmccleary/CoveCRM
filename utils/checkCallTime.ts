import { DateTime } from "luxon";
import { resolveLeadTimezone, type LeadLike } from "./leadTimezone";

/** Lead-local calling window (inclusive start, exclusive end). */
export const QUIET_HOURS = { startHour: 8, endHour: 21 };

/**
 * Soft/global check. If no timezone is provided, we **do not block**.
 * This prevents accidental global gating (e.g., defaulting to UTC/EST).
 */
export function isCallAllowed(
  timezone?: string | null,
  window: { startHour: number; endHour: number } = QUIET_HOURS
): boolean {
  if (!timezone) return true; // <- key change: never block when tz is unknown
  const now = DateTime.now().setZone(timezone);
  const hour = now.hour;
  return hour >= window.startHour && hour < window.endHour;
}

/** Decide for a specific lead; returns { allowed, zone }. */
export function isCallAllowedForLead(
  lead: LeadLike,
  window: { startHour: number; endHour: number } = QUIET_HOURS
): { allowed: boolean; zone: string | null } {
  const zone = resolveLeadTimezone(lead);
  if (!zone) {
    // Unknown timezone: allow the call; UI can show "(tz unknown)" if desired.
    return { allowed: true, zone: null };
  }
  const allowed = isCallAllowed(zone, window);

  // Minimal, safe debug (non-PII): helps trace quiet-hour skips in logs
  if (!allowed) {
    try {
      const id = (lead as any)?._id || (lead as any)?.id || "unknown";
      const now = DateTime.now().setZone(zone);
      // eslint-disable-next-line no-console
      console.log("quiet-hours: skip", {
        leadId: String(id),
        local: now.toFormat("ccc L/d @ h:mm a"),
        zone,
      });
    } catch {}
  }

  return { allowed, zone };
}

/** Pretty local time string for status/debug. */
export function localTimeString(zone: string | null): string {
  if (!zone) return "(tz unknown)";
  const now = DateTime.now().setZone(zone);
  return `${now.toFormat("ccc L/d @ h:mm a")} ${now.offsetNameShort}`;
}
