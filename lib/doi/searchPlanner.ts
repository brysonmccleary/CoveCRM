// lib/doi/searchPlanner.ts
// Generates targeted search queries for DOI agents.
export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

const INSURANCE_TERMS = [
  "insurance",
  "insurance agent",
  "life insurance",
  "broker",
  "financial services",
  "annuities",
  "medicare",
];

const PAGE_HINTS = ["team", "about", "contact"];

type AgentLike = {
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  agencyName?: string | null;
  licenseType?: string | null;
};

const normalize = (value?: string | null) => (value || "").trim();

export function generateSearchQueries(agent: AgentLike): string[] {
  const first = normalize(agent.firstName);
  const last = normalize(agent.lastName);
  const fullName = [first, last].filter(Boolean).join(" ").trim();
  if (!fullName) return [];

  const city = normalize(agent.city);
  const stateAbbr = normalize(agent.state).toUpperCase();
  const stateName = STATE_NAMES[stateAbbr] || "";
  const agency = normalize(agent.agencyName);
  const license = normalize(agent.licenseType);

  const queries = new Set<string>();
  const add = (query: string) => {
    const trimmed = query.replace(/\s+/g, " ").trim();
    if (trimmed) queries.add(trimmed);
  };

  add(`${fullName} insurance ${stateAbbr}`);
  if (stateName) add(`${fullName} insurance ${stateName}`);
  if (city) add(`${fullName} insurance ${city} ${stateAbbr}`);

  INSURANCE_TERMS.slice(0, 3).forEach((term) => add(`${fullName} ${term} ${stateAbbr}`));
  INSURANCE_TERMS.slice(3).forEach((term) => {
    if (stateName) add(`${fullName} ${term} ${stateName}`);
  });

  if (agency) {
    add(`${fullName} ${agency}`);
    add(`${fullName} ${agency} ${stateAbbr}`);
  }

  if (license) {
    add(`${fullName} ${license} insurance ${stateAbbr || stateName}`);
  }

  PAGE_HINTS.forEach((hint) => {
    if (stateAbbr) add(`${fullName} insurance ${hint} ${stateAbbr}`);
  });

  // Always include generic broker query
  add(`${fullName} insurance agent ${stateAbbr || stateName || "USA"}`);

  return Array.from(queries).slice(0, 10);
}
