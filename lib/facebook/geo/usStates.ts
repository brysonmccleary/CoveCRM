export type StateOption = { code: string; name: string };

export const US_STATES: StateOption[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  { code: "DC", name: "District of Columbia" },
];

const STATE_BY_CODE = new Map(US_STATES.map((s) => [s.code, s]));
const STATE_BY_NAME = new Map(US_STATES.map((s) => [s.name.toLowerCase(), s]));

export function normalizeStateCode(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (STATE_BY_CODE.has(upper)) return upper;
  return STATE_BY_NAME.get(raw.toLowerCase())?.code || "";
}

export function stateLabel(codeOrName: unknown): string {
  const code = normalizeStateCode(codeOrName);
  return STATE_BY_CODE.get(code)?.name || String(codeOrName || "").trim();
}

export function normalizeStateCodes(values: unknown): string[] {
  const raw = Array.isArray(values) ? values : String(values || "").split(",");
  const out: string[] = [];
  for (const value of raw) {
    const code = normalizeStateCode(value);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

export function isStateAllowed(state: unknown, licensedStates: unknown): boolean {
  const selected = normalizeStateCodes(licensedStates);
  if (!selected.length) return true;
  const code = normalizeStateCode(state);
  return !!code && selected.includes(code);
}
