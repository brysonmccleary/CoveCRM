// utils/leadTimezone.ts
// Resolve a best-guess IANA timezone for a lead using explicit fields first,
// then state as a fallback. (Area code/zip heuristics can be added later.)

export type LeadLike = Record<string, any> | null | undefined;

const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DC: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  IA: "America/Chicago",
  ID: "America/Boise",          // default (state split)
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  KS: "America/Chicago",        // (state split)
  KY: "America/New_York",       // (state split)
  LA: "America/Chicago",
  MA: "America/New_York",
  MD: "America/New_York",
  ME: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MO: "America/Chicago",
  MS: "America/Chicago",
  MT: "America/Denver",
  NC: "America/New_York",
  ND: "America/Chicago",        // (state split)
  NE: "America/Chicago",        // (state split)
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NV: "America/Los_Angeles",
  NY: "America/New_York",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",    // (state split)
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",        // (state split)
  TN: "America/Chicago",        // (state split)
  TX: "America/Chicago",        // (state split)
  UT: "America/Denver",
  VA: "America/New_York",
  VT: "America/New_York",
  WA: "America/Los_Angeles",
  WI: "America/Chicago",
  WV: "America/New_York",
  WY: "America/Denver",
};

function pick(obj: any, keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export function normalizeState(val?: string): string | null {
  if (!val) return null;
  const s = String(val).trim().toUpperCase();
  if (STATE_TZ[s]) return s;
  // try to coerce full names -> abbr
  const map: Record<string, string> = {
    "ALABAMA":"AL","ALASKA":"AK","ARIZONA":"AZ","ARKANSAS":"AR","CALIFORNIA":"CA","COLORADO":"CO","CONNECTICUT":"CT","DELAWARE":"DE",
    "DISTRICT OF COLUMBIA":"DC","WASHINGTON DC":"DC","FLORIDA":"FL","GEORGIA":"GA","HAWAII":"HI","IDAHO":"ID","ILLINOIS":"IL","INDIANA":"IN",
    "IOWA":"IA","KANSAS":"KS","KENTUCKY":"KY","LOUISIANA":"LA","MAINE":"ME","MARYLAND":"MD","MASSACHUSETTS":"MA","MICHIGAN":"MI","MINNESOTA":"MN",
    "MISSISSIPPI":"MS","MISSOURI":"MO","MONTANA":"MT","NEBRASKA":"NE","NEVADA":"NV","NEW HAMPSHIRE":"NH","NEW JERSEY":"NJ",
    "NEW MEXICO":"NM","NEW YORK":"NY","NORTH CAROLINA":"NC","NORTH DAKOTA":"ND","OHIO":"OH","OKLAHOMA":"OK","OREGON":"OR","PENNSYLVANIA":"PA",
    "RHODE ISLAND":"RI","SOUTH CAROLINA":"SC","SOUTH DAKOTA":"SD","TENNESSEE":"TN","TEXAS":"TX","UTAH":"UT","VERMONT":"VT","VIRGINIA":"VA",
    "WASHINGTON":"WA","WEST VIRGINIA":"WV","WISCONSIN":"WI","WYOMING":"WY"
  };
  const full = map[s] || map[s.replace(/\./g, "")];
  return full || null;
}

/** Best-effort IANA timezone from a lead. Returns null if unknown. */
export function resolveLeadTimezone(lead: LeadLike): string | null {
  if (!lead) return null;

  // 1) Explicit tz fields
  const explicit = pick(lead, ["timezone","timeZone","tz","ianaTimezone","IanaTimezone","IANA_TZ"]);
  if (explicit) return explicit;

  // 2) State (abbr or full)
  const stateRaw = pick(lead, ["state","State","STATE","st","St","ST"]);
  const abbr = normalizeState(stateRaw);
  if (abbr && STATE_TZ[abbr]) return STATE_TZ[abbr];

  // 3) If we cannot determine confidently, return null (caller decides policy)
  return null;
}
