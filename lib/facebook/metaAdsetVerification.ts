import { metaGraphUrl } from "@/lib/meta/graphApi";

type FetchLike = typeof fetch;

function normalizedRegionKeys(targeting: any): string[] {
  const regions = targeting?.geo_locations?.regions;
  if (!Array.isArray(regions)) return [];
  return Array.from(new Set(regions.map((region: any) => String(region?.key || "").trim()).filter(Boolean))).sort();
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

  const expectedRegions = normalizedRegionKeys(input.expectedTargeting);
  const actualRegions = normalizedRegionKeys(input.actual?.targeting);
  if (
    expectedRegions.length !== actualRegions.length ||
    expectedRegions.some((key, index) => key !== actualRegions[index])
  ) {
    throw new Error(
      `Meta ad set verification failed: expected region keys [${expectedRegions.join(", ")}], got [${actualRegions.join(", ")}]`
    );
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
