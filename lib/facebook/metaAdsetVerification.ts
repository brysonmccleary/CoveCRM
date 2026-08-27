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

function normalizedIds(value: unknown): string[] {
  return normalizedScalars(Array.isArray(value) ? value.map((item: any) => item?.id || item?.key || item) : []);
}

function normalizedGeoItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => JSON.stringify({
    key: String(item?.key || ""),
    country: String(item?.country || ""),
    region: String(item?.region || ""),
    primary_city_id: String(item?.primary_city_id || ""),
    radius: String(item?.radius || ""),
    distance_unit: String(item?.distance_unit || ""),
  })).sort();
}

function stableCanonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableCanonical).sort().join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableCanonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
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
  const genders = normalizedScalars(targeting?.genders);
  return {
    ageMin: Number(targeting?.age_min ?? 18),
    ageMax: Number(targeting?.age_max ?? 65),
    genders: !genders.length || JSON.stringify(genders) === JSON.stringify(["1", "2"]) ? ["all"] : genders,
    countries: normalizedScalars(targeting?.geo_locations?.countries),
    regions: normalizedRegionKeys(targeting),
    zips: normalizedGeoItems(targeting?.geo_locations?.zips),
    cities: normalizedGeoItems(targeting?.geo_locations?.cities),
    customLocations: normalizedGeoItems(targeting?.geo_locations?.custom_locations),
    excludedGeoLocations: stableCanonical(targeting?.excluded_geo_locations || {}),
    locationTypes: normalizedScalars(targeting?.geo_locations?.location_types),
    locales: normalizedScalars(targeting?.locales),
    interestGroups: normalizedInterestGroups(targeting),
    interests: normalizedIds(targeting?.interests),
    behaviors: normalizedIds(targeting?.behaviors),
    demographics: stableCanonical({
      demographics: targeting?.demographics || [],
      education_statuses: targeting?.education_statuses || [],
      relationship_statuses: targeting?.relationship_statuses || [],
      life_events: targeting?.life_events || [],
      industries: targeting?.industries || [],
      work_positions: targeting?.work_positions || [],
      work_employers: targeting?.work_employers || [],
      field_of_study: targeting?.field_of_study || [],
      schools: targeting?.schools || [],
      income: targeting?.income || [],
      family_statuses: targeting?.family_statuses || [],
    }),
    customAudiences: normalizedIds(targeting?.custom_audiences),
    excludedCustomAudiences: normalizedIds(targeting?.excluded_custom_audiences),
    lookalikes: stableCanonical(targeting?.lookalike_spec || {}),
    publisherPlatforms: normalizedScalars(targeting?.publisher_platforms),
    facebookPositions: normalizedScalars(targeting?.facebook_positions),
    instagramPositions: normalizedScalars(targeting?.instagram_positions),
    advantageAudience: Number(targeting?.targeting_automation?.advantage_audience ?? 0),
    targetingRelaxationTypes: normalizedScalars(targeting?.targeting_relaxation_types),
  };
}

function normalizedAttribution(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    event_type: String(item?.event_type || ""),
    window_days: Number(item?.window_days || 0),
  })).sort((a, b) => `${a.event_type}:${a.window_days}`.localeCompare(`${b.event_type}:${b.window_days}`));
}

export function assertMetaAdsetMatches(input: {
  actual: any;
  expectedDailyBudgetCents: number;
  expectedTargeting: any;
  expected?: {
    optimizationGoal?: string;
    billingEvent?: string;
    destinationType?: string;
    promotedObject?: Record<string, any>;
    attributionSpec?: Array<Record<string, any>>;
  };
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
    "ageMin",
    "ageMax",
    "genders",
    "countries",
    "zips",
    "cities",
    "customLocations",
    "excludedGeoLocations",
    "locationTypes",
    "locales",
    "interestGroups",
    "interests",
    "behaviors",
    "demographics",
    "customAudiences",
    "excludedCustomAudiences",
    "lookalikes",
    "publisherPlatforms",
    "facebookPositions",
    "instagramPositions",
    "advantageAudience",
    "targetingRelaxationTypes",
  ];
  for (const field of fields) {
    if (JSON.stringify(expectedAudience[field]) !== JSON.stringify(actualAudience[field])) {
      throw new Error(
        `Meta ad set verification failed: ${field} expected ${JSON.stringify(expectedAudience[field])}, got ${JSON.stringify(actualAudience[field])}`
      );
    }
  }
  const expected = input.expected || {};
  const scalarChecks: Array<[string, unknown, unknown]> = [
    ["optimization_goal", expected.optimizationGoal, input.actual?.optimization_goal],
    ["billing_event", expected.billingEvent, input.actual?.billing_event],
    ["destination_type", expected.destinationType, input.actual?.destination_type],
  ];
  for (const [field, intended, actual] of scalarChecks) {
    if (intended !== undefined && String(intended) !== String(actual || "")) {
      throw new Error(`Meta ad set verification failed: ${field} expected ${String(intended)}, got ${String(actual || "missing")}`);
    }
  }
  if (expected.promotedObject) {
    for (const field of ["page_id", "pixel_id", "custom_event_type"]) {
      if (expected.promotedObject[field] !== undefined &&
          String(expected.promotedObject[field]) !== String(input.actual?.promoted_object?.[field] || "")) {
        throw new Error(`Meta ad set verification failed: promoted_object.${field} expected ${String(expected.promotedObject[field])}, got ${String(input.actual?.promoted_object?.[field] || "missing")}`);
      }
    }
  }
  if (expected.attributionSpec && JSON.stringify(normalizedAttribution(expected.attributionSpec)) !== JSON.stringify(normalizedAttribution(input.actual?.attribution_spec))) {
    throw new Error(`Meta ad set verification failed: attribution_spec expected ${JSON.stringify(normalizedAttribution(expected.attributionSpec))}, got ${JSON.stringify(normalizedAttribution(input.actual?.attribution_spec))}`);
  }
}

export async function verifyMetaAdset(input: {
  metaAdsetId: string;
  accessToken: string;
  expectedDailyBudgetCents: number;
  expectedTargeting: any;
  metaCampaignId?: string;
  expectedSpecialAdCategories?: string[];
  expected?: Parameters<typeof assertMetaAdsetMatches>[0]["expected"];
  fetchImpl?: FetchLike;
}) {
  const fetchImpl = input.fetchImpl || fetch;
  const params = new URLSearchParams();
  if (input.metaCampaignId && input.expectedSpecialAdCategories) {
    const campaignParams = new URLSearchParams({
      fields: "special_ad_categories,objective",
      access_token: input.accessToken,
    });
    const campaignResponse = await fetchImpl(`${metaGraphUrl(input.metaCampaignId)}?${campaignParams.toString()}`, { method: "GET" });
    const campaignJson = await campaignResponse.json().catch(() => ({}));
    if (!campaignResponse.ok) throw new Error(`Meta campaign verification read failed: ${JSON.stringify(campaignJson)}`);
    if (JSON.stringify(normalizedScalars(campaignJson?.special_ad_categories)) !== JSON.stringify(normalizedScalars(input.expectedSpecialAdCategories))) {
      throw new Error(`Meta campaign verification failed: special_ad_categories expected ${JSON.stringify(normalizedScalars(input.expectedSpecialAdCategories))}, got ${JSON.stringify(normalizedScalars(campaignJson?.special_ad_categories))}`);
    }
  }
  params.set("fields", "daily_budget,targeting,optimization_goal,billing_event,destination_type,promoted_object,attribution_spec");
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
    expected: input.expected,
  });
  return json;
}
