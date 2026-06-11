// lib/drips/computeScheduledDripSendAt.ts
//
// Single source of truth for all V2 drip send-time computation.
// All delays are cumulative from enrolledAt.
// Quiet hours (9PM–8AM lead-local) are applied at computation time so
// the stored sendAt is always a legal send window — the worker never
// needs to re-check quiet hours.

import { DateTime } from "luxon";
import { getTimezoneFromState } from "@/utils/timezone";

export type DripDelayUnit = "hours" | "days" | "weeks" | "months";

const QUIET_START_HOUR = 21; // 9:00 PM
const QUIET_END_HOUR = 8;   // 8:00 AM
const SEND_HOUR = 9;        // 9:00 AM (default for day/week/month steps)

// ── Quiet hours helper ──────────────────────────────────────────────────────

/**
 * If dt falls in the quiet window (9PM–8AM lead-local), push forward to
 * the next legal start (8AM same or next day). Otherwise return unchanged.
 */
function applyQuietHours(dt: DateTime): DateTime {
  const h = dt.hour;
  if (h >= QUIET_START_HOUR) {
    return dt.plus({ days: 1 }).set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  }
  if (h < QUIET_END_HOUR) {
    return dt.set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  }
  return dt;
}

// ── Timezone resolution ─────────────────────────────────────────────────────

export function resolveLeadTimezone(state?: string | null): string {
  if (!state) {
    console.warn("[drip/computeSendAt] No lead state — falling back to America/New_York");
    return "America/New_York";
  }
  const tz = getTimezoneFromState(state);
  if (!tz) {
    console.warn(
      `[drip/computeSendAt] Could not resolve timezone for state "${state}" — falling back to America/New_York`
    );
    return "America/New_York";
  }
  return tz;
}

// ── Legacy day-field parser ─────────────────────────────────────────────────

export interface ParsedDelay {
  value: number;
  unit: DripDelayUnit;
}

/**
 * Parse a legacy "day" string like "Day 2", "Month 3", "Week 1",
 * "immediately", "3 hours", etc. into a normalized delay pair.
 * Returns null if the string cannot be parsed.
 */
export function parseLegacyDayField(day?: string | null): ParsedDelay | null {
  if (!day) return null;
  const raw = String(day).trim().toLowerCase();

  if (raw === "immediately" || raw === "immediate" || raw === "day 0" || raw === "0") {
    return { value: 0, unit: "days" };
  }

  // "month 3" / "3 months" / "Month 3"
  const monthM = raw.match(/(?:months?\s+(\d+)|(\d+)\s+months?)/);
  if (monthM) {
    const n = parseInt(monthM[1] || monthM[2], 10);
    if (!isNaN(n) && n >= 0) return { value: n, unit: "months" };
  }

  // "week 2" / "2 weeks" / "Week 2"
  const weekM = raw.match(/(?:weeks?\s+(\d+)|(\d+)\s+weeks?)/);
  if (weekM) {
    const n = parseInt(weekM[1] || weekM[2], 10);
    if (!isNaN(n) && n >= 0) return { value: n, unit: "weeks" };
  }

  // "hour 3" / "3 hours" / "Hour 3"
  const hourM = raw.match(/(?:hours?\s+(\d+)|(\d+)\s+hours?)/);
  if (hourM) {
    const n = parseInt(hourM[1] || hourM[2], 10);
    if (!isNaN(n) && n >= 0) return { value: n, unit: "hours" };
  }

  // "day 2" / "2 days" / "Day 50" — most common legacy format
  const dayM = raw.match(/(?:days?\s+(\d+)|(\d+)\s+days?|^day\s+(\d+)$|^(\d+)$)/);
  if (dayM) {
    const n = parseInt(dayM[1] || dayM[2] || dayM[3] || dayM[4], 10);
    if (!isNaN(n) && n >= 0) return { value: n, unit: "days" };
  }

  return null;
}

/**
 * Convert a delayValue + delayUnit pair back to a legacy-compatible "day" string.
 * Used so newly-created steps remain compatible with V1 run-drips.
 */
export function delayToLegacyDayString(value: number, unit: DripDelayUnit): string {
  if (value === 0 && unit === "days") return "immediately";
  if (unit === "hours") return `${value} hours`;
  if (unit === "days") return `Day ${value}`;
  if (unit === "weeks") return `Week ${value}`;
  if (unit === "months") return `Month ${value}`;
  return `Day ${value}`;
}

// ── Birthday check ──────────────────────────────────────────────────────────

export function isBirthdayStep(day?: string | null): boolean {
  if (!day) return false;
  return /birthday/i.test(String(day));
}

// ── Main send-at computation ────────────────────────────────────────────────

export interface StepDelayInput {
  delayValue?: number | null;
  delayUnit?: DripDelayUnit | null;
  day?: string | null; // legacy field; used when delayValue/delayUnit are absent
}

/**
 * Compute the exact UTC sendAt for a drip step.
 * Returns null when the step must be skipped (birthday, or unresolvable timing).
 *
 * All delays are cumulative from enrolledAt:
 *   - "Day 7" / delayValue=7 delayUnit=days → enrollment + 7 days at 9AM lead-local
 *   - "Month 3" / delayValue=3 delayUnit=months → enrollment + 3 calendar months at 9AM
 *   - "immediately" / delayValue=0 → enrolledAt, quiet-hours adjusted
 *   - "3 hours" / delayValue=3 delayUnit=hours → enrolledAt + 3h, quiet-hours adjusted
 */
export function computeScheduledDripSendAt(params: {
  enrolledAt: Date;
  step: StepDelayInput;
  leadState?: string | null;
}): Date | null {
  const { enrolledAt, step, leadState } = params;

  // Birthday steps are permanently disabled
  if (isBirthdayStep(step.day)) {
    return null;
  }

  const tz = resolveLeadTimezone(leadState);
  const baseUTC = DateTime.fromJSDate(enrolledAt).toUTC();

  // Resolve delay (explicit fields take priority over legacy "day" string)
  let value: number;
  let unit: DripDelayUnit;

  if (step.delayValue != null && step.delayUnit) {
    value = Math.max(0, isNaN(Number(step.delayValue)) ? 0 : Number(step.delayValue));
    unit = step.delayUnit;
  } else {
    const parsed = parseLegacyDayField(step.day);
    if (!parsed) {
      console.warn(
        `[drip/computeSendAt] Cannot parse day field "${step.day}" — defaulting to 1 day`
      );
      value = 1;
      unit = "days";
    } else {
      value = parsed.value;
      unit = parsed.unit;
    }
  }

  if (unit === "hours") {
    // Add exact hours, then apply quiet hours in lead-local
    const rawUTC = baseUTC.plus({ hours: value });
    const leadLocal = rawUTC.setZone(tz);
    return applyQuietHours(leadLocal).toUTC().toJSDate();
  }

  if (unit === "days") {
    if (value === 0) {
      // Immediate: from enrollment time, quiet-hours deferred
      const leadLocal = baseUTC.setZone(tz);
      return applyQuietHours(leadLocal).toUTC().toJSDate();
    }
    const enrollLocal = baseUTC.setZone(tz);
    const targetDay = enrollLocal.startOf("day").plus({ days: value }).set({
      hour: SEND_HOUR, minute: 0, second: 0, millisecond: 0,
    });
    return applyQuietHours(targetDay).toUTC().toJSDate();
  }

  if (unit === "weeks") {
    const enrollLocal = baseUTC.setZone(tz);
    const targetDay = enrollLocal.startOf("day").plus({ weeks: value }).set({
      hour: SEND_HOUR, minute: 0, second: 0, millisecond: 0,
    });
    return applyQuietHours(targetDay).toUTC().toJSDate();
  }

  if (unit === "months") {
    // True calendar months via Luxon — handles end-of-month correctly
    const enrollLocal = baseUTC.setZone(tz);
    const targetDay = enrollLocal.startOf("day").plus({ months: value }).set({
      hour: SEND_HOUR, minute: 0, second: 0, millisecond: 0,
    });
    return applyQuietHours(targetDay).toUTC().toJSDate();
  }

  return null;
}
