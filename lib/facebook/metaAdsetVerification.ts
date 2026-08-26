import { metaGraphUrl } from "@/lib/meta/graphApi";

type FetchLike = typeof fetch;

function normalizedRegionKeys(targeting: any): string[] {
  const regions = targeting?.geo_locations?.regions;
  if (!Array.isArray(regions)) return [];
  return Array.from(new Set(regions.map((region: any) => String(region?.key || "").trim()).filter(Boolean))).sort();
}

function normalizedScalars(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean))).sort();
}

function normalizedInterestGroups(targeting: any): string[][] {
  const groups = Array.isArray(targeting?.flexible_spec) ? targeting.flexible_spec : [];
  return groups
    .map((group: any) => normalizedScalars(
      Array.isArray(group?.interests) ? group.interests.map((interest: any) => interest?.id) : []
    ))
    .filter((group: string[]) => group.length > 0)
    .sort((a: string[], b: string[]) => a.join(",").localeCompare(b.join(",")));
}

function normalizedAudience(targeting: any) {
  return {
    regions: normalizedRegionKeys(targeting),
    locationTypes: normalizedScalars(targeting?.geo_locations?.location_types),
    locales: normalizedScalars(targeting?.locales),
    interestGroups: normalizedInterestGroups(targeting),
    publisherPlatforms: normalizedScalars(targeting?.publisher_platforms),
    facebookPositions: normalizedScalars(targeting?.facebook_positions),
    instagramPositions: normalizedScalars(targeting?.instagram_positions),
    advantageAudience: Number(targeting?.targeting_automation?.advantage_audience ?? 0),
  };
}

export function assertMetaAdsetMatches(input: {
  actual: any;
  expectedDailyBudgetCents: number;
  expectedTargeting: any;
}) {
  const actualBudget = Number(input.actual?.daily_budget);
  if (!Number.isFinite(actualBudget) || actualBudget !== input.expectedDailyBudgetCents) {
    throw new Error(
      `Meta ad set verification failed: expected daily_budget=${input.expectedDailyBudgetCents}, got ${String(input.actual?.daily_budget ?? "missing")}`
    );
  }

  const expectedAudience = normalizedAudience(input.expectedTargeting);
  const actualAudience = normalizedAudience(input.actual?.targeting);
  if (JSON.stringify(expectedAudience.regions) !== JSON.stringify(actualAudience.regions)) {
    throw new Error(
      `Meta ad set verification failed: expected region keys [${expectedAudience.regions.join(", ")}], got [${actualAudience.regions.join(", ")}]`
    );
  }
  const fields: Array<keyof Omit<typeof expectedAudience, "regions">> = [
    "locationTypes",
    "locales",
    "interestGroups",
    "publisherPlatforms",
    "facebookPositions",
    "instagramPositions",
    "advantageAudience",
  ];
  for (const field of fields) {
    if (JSON.stringify(expectedAudience[field]) !== JSON.stringify(actualAudience[field])) {
      throw new Error(
        `Meta ad set verification failed: ${field} expected ${JSON.stringify(expectedAudience[field])}, got ${JSON.stringify(actualAudience[field])}`
      );
    }
  }
}

export async function verifyMetaAdset(input: {
  metaAdsetId: string;
  accessToken: string;
  expectedDailyBudgetCents: number;
  expectedTargeting: any;
  fetchImpl?: FetchLike;
}) {
  const fetchImpl = input.fetchImpl || fetch;
  const params = new URLSearchParams();
  params.set("fields", "daily_budget,targeting");
  params.set("access_token", input.accessToken);
  const response = await fetchImpl(
    `${metaGraphUrl(input.metaAdsetId)}?${params.toString()}`,
    { method: "GET" }
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Meta ad set verification read failed: ${JSON.stringify(json)}`);
  }
  assertMetaAdsetMatches({
    actual: json,
    expectedDailyBudgetCents: input.expectedDailyBudgetCents,
    expectedTargeting: input.expectedTargeting,
  });
  return json;
}
