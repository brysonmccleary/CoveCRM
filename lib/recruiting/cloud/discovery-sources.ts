import type { SocialPlatform } from "@/lib/recruiting/social/types";

export const DISCOVERY_SOURCE_TYPES = [
  "university_college_athletes",
  "newly_licensed_insurance",
  "entry_level_sales_organizations",
  "emerging_entrepreneur_creators",
  "door_to_door_sales_organizations",
  "insurance_agencies_brokerages",
] as const;

export type DiscoverySourceType = typeof DISCOVERY_SOURCE_TYPES[number];

export const DISCOVERY_SOURCE_COPY: Record<DiscoverySourceType, { label: string; query: string }> = {
  university_college_athletes: { label: "University / college athletes", query: "university college athlete athletics student athlete" },
  newly_licensed_insurance: { label: "Newly licensed insurance professionals", query: "newly licensed insurance agent producer life health property casualty" },
  entry_level_sales_organizations: { label: "Entry-level sales organizations", query: "entry level sales representative business development commission sales" },
  emerging_entrepreneur_creators: { label: "Emerging entrepreneur creators", query: "entrepreneur creator sales business growth" },
  door_to_door_sales_organizations: { label: "Door-to-door sales organizations", query: "door to door sales representative solar roofing pest control home security" },
  insurance_agencies_brokerages: { label: "Insurance agencies and brokerages", query: "insurance agency brokerage producer agent" },
};

export function normalizeDiscoverySourceTypes(value: unknown): DiscoverySourceType[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(DISCOVERY_SOURCE_TYPES);
  return [...new Set(value.map(String).filter((item) => allowed.has(item)))] as DiscoverySourceType[];
}

export function normalizeSeedAccounts(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\n,;\t]/);
  const normalized: string[] = [];
  for (const item of raw) {
    const seed = String(item || "").trim().replace(/^['"]|['"]$/g, "").trim().replace(/\s+/g, " ").slice(0, 160);
    if (["username", "handle", "profile", "profile url", "profile_url", "url"].includes(seed.toLowerCase())) continue;
    if (seed.length < 2 || !/^[a-zA-Z0-9@._:/?=&%+\-\s]+$/.test(seed)) continue;
    if (!normalized.some((existing) => existing.toLowerCase() === seed.toLowerCase())) normalized.push(seed);
    if (normalized.length >= 100) break;
  }
  return normalized;
}

export function instagramSeedProfileUrl(seed: string): string | null {
  const trimmed = String(seed || "").trim();
  try {
    const parsed = new URL(trimmed);
    if (!["instagram.com", "www.instagram.com"].includes(parsed.hostname.toLowerCase())) return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 1 || !/^[a-zA-Z0-9._]{1,30}$/.test(segments[0])) return null;
    return `https://www.instagram.com/${segments[0]}/`;
  } catch {
    const handle = trimmed.replace(/^@/, "");
    return /^[a-zA-Z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}/` : null;
  }
}

export function buildDiscoverySearchQueries(input: {
  platform: SocialPlatform;
  audienceDescription: string;
  location: string;
  examples: string[];
  sourceTypes: DiscoverySourceType[];
  seedAccounts: string[];
}): string[] {
  const geography = ["United States", input.location && input.location !== "United States" ? input.location : ""].filter(Boolean).join(" ");
  const base = [geography, ...input.examples, input.audienceDescription].filter(Boolean).join(" ").slice(0, 180);
  const queries = [base];
  for (const sourceType of input.sourceTypes) {
    queries.push([geography, DISCOVERY_SOURCE_COPY[sourceType].query, input.audienceDescription].filter(Boolean).join(" ").slice(0, 180));
  }
  if (input.platform === "linkedin") {
    for (const seed of input.seedAccounts) queries.push([geography, seed, input.audienceDescription].filter(Boolean).join(" ").slice(0, 180));
  }
  return [...new Set(queries.filter((query) => query.length >= 2))].slice(0, 30);
}

export function planDiscoverySource(
  platform: SocialPlatform,
  searchQueries: string[],
  primarySeedAccounts: string[],
  derivedSeedAccounts: string[],
  sourceCursor: number,
) {
  const queries = searchQueries.length ? searchQueries : ["United States"];
  const normalizedCursor = Math.max(0, Math.floor(sourceCursor || 0));
  if (platform !== "instagram" || (!primarySeedAccounts.length && !derivedSeedAccounts.length)) {
    return {
      activeQuery: String(queries[normalizedCursor % queries.length]),
      seedPool: null as "primary" | "derived" | null,
      seedSourceCursor: 0,
    };
  }

  const cycle = Math.floor(normalizedCursor / 10);
  const phase = normalizedCursor % 10;
  const usePrimary = primarySeedAccounts.length > 0 && (phase < 7 || !derivedSeedAccounts.length);
  const useDerived = !usePrimary && derivedSeedAccounts.length > 0 && phase < 8;
  const seedPool = usePrimary ? "primary" : useDerived ? "derived" : null;
  const primarySlotsPerCycle = derivedSeedAccounts.length ? 7 : 8;
  const primarySequence = cycle * primarySlotsPerCycle + Math.min(phase, primarySlotsPerCycle - 1);
  const derivedSlotsPerCycle = primarySeedAccounts.length ? 1 : 8;
  const derivedSequence = cycle * derivedSlotsPerCycle + (primarySeedAccounts.length ? 0 : Math.min(phase, 7));
  return {
    activeQuery: String(queries[(cycle * 2 + Math.max(0, phase - 8)) % queries.length]),
    seedPool,
    seedSourceCursor: seedPool === "primary" ? primarySequence : seedPool === "derived" ? derivedSequence : 0,
  };
}
