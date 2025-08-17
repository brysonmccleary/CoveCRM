// /utils/timezone.ts
import { DateTime } from "luxon";

/** Normalize a free-form state input to a 2-letter USPS code (e.g., "Georgia" -> "GA"). */
const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", al: "AL",
  alaska: "AK", ak: "AK",
  arizona: "AZ", az: "AZ",
  arkansas: "AR", ar: "AR",
  california: "CA", ca: "CA",
  colorado: "CO", co: "CO",
  connecticut: "CT", ct: "CT",
  delaware: "DE", de: "DE",
  "district of columbia": "DC", district: "DC", dc: "DC", "washington dc": "DC", "washington,dc": "DC", washingtondc: "DC",
  florida: "FL", fl: "FL",
  georgia: "GA", ga: "GA",
  hawaii: "HI", hi: "HI",
  idaho: "ID", id: "ID",
  illinois: "IL", il: "IL",
  indiana: "IN", in: "IN",
  iowa: "IA", ia: "IA",
  kansas: "KS", ks: "KS",
  kentucky: "KY", ky: "KY",
  louisiana: "LA", la: "LA",
  maine: "ME", me: "ME",
  maryland: "MD", md: "MD",
  massachusetts: "MA", ma: "MA",
  michigan: "MI", mi: "MI",
  minnesota: "MN", mn: "MN",
  mississippi: "MS", ms: "MS",
  missouri: "MO", mo: "MO",
  montana: "MT", mt: "MT",
  nebraska: "NE", ne: "NE",
  nevada: "NV", nv: "NV",
  "new hampshire": "NH", nh: "NH",
  "new jersey": "NJ", nj: "NJ",
  "new mexico": "NM", nm: "NM",
  "new york": "NY", ny: "NY",
  "north carolina": "NC", nc: "NC",
  "north dakota": "ND", nd: "ND",
  ohio: "OH", oh: "OH",
  oklahoma: "OK", ok: "OK",
  oregon: "OR", or: "OR",
  pennsylvania: "PA", pa: "PA",
  "rhode island": "RI", ri: "RI",
  "south carolina": "SC", sc: "SC",
  "south dakota": "SD", sd: "SD",
  tennessee: "TN", tn: "TN",
  texas: "TX", tx: "TX",
  utah: "UT", ut: "UT",
  vermont: "VT", vt: "VT",
  virginia: "VA", va: "VA",
  washington: "WA", wa: "WA",
  "west virginia": "WV", wv: "WV",
  wisconsin: "WI", wi: "WI",
  wyoming: "WY", wy: "WY",
};

/** USPS code → IANA timezone (dominant business zone per state). */
export const stateToTimezone: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix", // no DST
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Boise", // N. Idaho has Pacific; Boise (Mountain) is most common for business
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis", // mixed; this is the dominant zone
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York", // west KY is Central; we pick ET as dominant
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago", // east TN is ET; we default to CT for consistency with prior code
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
};

/** Try to resolve a 2-letter state code from free-form input. */
export function resolveStateCode(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;

  // Exact 2-letter code?
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    if (stateToTimezone[code]) return code;
  }

  // Name → code (normalize to letters only)
  const key = trimmed.toLowerCase().replace(/[^a-z]/g, "");
  return STATE_NAME_TO_CODE[key] || null;
}

/**
 * Return an IANA timezone for a given US state code or full name.
 * Falls back to "America/Chicago" if unknown (to preserve your prior behavior).
 */
export function getTimezoneFromState(state: string): string {
  const code = resolveStateCode(state);
  return (code && stateToTimezone[code]) || "America/Chicago";
}

/**
 * Convert a clock time between zones.
 * Example: convertTimeBetweenZones({ time: "6:00 PM", fromZone: "America/New_York", toZone: "America/Denver" })
 */
export function convertTimeBetweenZones({
  time,
  fromZone,
  toZone,
}: {
  time: string; // e.g., "6:00 PM"
  fromZone: string;
  toZone: string;
}): DateTime {
  const dt = DateTime.fromFormat(time, "h:mm a", { zone: fromZone, setZone: true });
  return dt.setZone(toZone);
}

/** Convenience: format an ISO (UTC or with offset) in a target zone for SMS/UI. */
export function formatIsoInZone(
  iso: string,
  zone: string,
  format = "ccc, MMM d 'at' h:mm a"
): string {
  const dt = DateTime.fromISO(iso, { setZone: true });
  return dt.setZone(zone).toFormat(format);
}
