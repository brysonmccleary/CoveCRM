import { buildCampaignStructure } from "@/lib/facebook/buildCampaignStructure";
import { claimLaunchCampaign } from "@/lib/facebook/claimLaunchCampaign";
import { buildMetaStateTargeting } from "@/lib/facebook/geo/metaTargeting";
import { META_REGION_MAP } from "@/lib/facebook/geo/metaRegionMap";
import { buildLaunchFingerprint, requireDailyBudgetCents } from "@/lib/facebook/launchFingerprint";
import { assertMetaAdsetMatches, verifyMetaAdset } from "@/lib/facebook/metaAdsetVerification";

const SEVENTEEN_STATES = [
  "AL", "GA", "WA", "UT", "TX", "OH", "NC", "NM", "LA",
  "KY", "HI", "FL", "CO", "CA", "AR", "AZ", "AK",
];

function fingerprint(dailyBudgetCents: number, licensedStates = SEVENTEEN_STATES) {
  return buildLaunchFingerprint({
    adAccountId: "act_123",
    pageId: "page-1",
    leadType: "final_expense",
    audienceSegment: "standard",
    campaignType: "hosted_funnel",
    licensedStates,
    dailyBudgetCents,
    funnelType: "lead_form",
    creatives: [{
      headline: "Coverage Up To $50,000",
      primaryText: "Review final expense coverage options.",
      cta: "LEARN_MORE",
      uniquenessFingerprint: "creative-1",
      renderedCreativeDataUrl: "data:image/png;base64,AAAA",
    }],
  });
}

describe("Meta launch identity, budget, targeting, and verification", () => {
  test("same display name with a different budget atomically claims a different campaign fingerprint", async () => {
    const campaignModel = { findOneAndUpdate: jest.fn() };
    campaignModel.findOneAndUpdate
      .mockResolvedValueOnce({ _id: "campaign-500" })
      .mockResolvedValueOnce({ _id: "campaign-2500" });

    const budget500 = fingerprint(500);
    const budget2500 = fingerprint(2500);
    expect(budget500).not.toBe(budget2500);

    const sharedSet = { campaignName: "Final Expense - 17 states Campaign" };
    await claimLaunchCampaign({
      campaignModel,
      userEmail: "agent@example.com",
      launchFingerprint: budget500,
      setOnInsert: { userId: "user-1" },
      set: sharedSet,
    });
    await claimLaunchCampaign({
      campaignModel,
      userEmail: "agent@example.com",
      launchFingerprint: budget2500,
      setOnInsert: { userId: "user-1" },
      set: sharedSet,
    });

    expect(campaignModel.findOneAndUpdate.mock.calls[0][0]).toEqual(expect.objectContaining({
      userEmail: "agent@example.com",
      launchFingerprint: budget500,
      $or: expect.any(Array),
    }));
    expect(campaignModel.findOneAndUpdate.mock.calls[1][0]).toEqual(expect.objectContaining({
      userEmail: "agent@example.com",
      launchFingerprint: budget2500,
      $or: expect.any(Array),
    }));
    expect(campaignModel.findOneAndUpdate.mock.calls[0][2]).toEqual({ upsert: true, new: true });
  });

  test("exact launch fingerprint is stable across state ordering", () => {
    expect(fingerprint(500, [...SEVENTEEN_STATES].reverse())).toBe(fingerprint(500));
  });

  test("changing the optimization goal changes launch identity", () => {
    const base = {
      adAccountId: "act_123",
      pageId: "page-1",
      leadType: "final_expense",
      audienceSegment: "standard",
      campaignType: "native_form",
      licensedStates: ["AZ"],
      dailyBudgetCents: 500,
      funnelType: "lead_form",
      creatives: [{ headline: "Coverage", primaryText: "Review coverage options." }],
    };
    expect(buildLaunchFingerprint({ ...base, performanceGoal: "LEAD_GENERATION" })).not.toBe(
      buildLaunchFingerprint({ ...base, performanceGoal: "QUALITY_LEAD" })
    );
  });

  test("a concurrent exact launch cannot acquire the same atomic claim", async () => {
    const campaignModel = {
      findOneAndUpdate: jest.fn().mockRejectedValue({ code: 11000 }),
    };
    await expect(claimLaunchCampaign({
      campaignModel,
      userEmail: "agent@example.com",
      launchFingerprint: fingerprint(500),
      setOnInsert: { userId: "user-1" },
      set: { campaignName: "Final Expense - 17 states Campaign" },
    })).rejects.toThrow("already in progress");
  });

  test("$5 produces a daily_budget of exactly 500 without a fallback", () => {
    const cents = requireDailyBudgetCents(5 * 100);
    const structure = buildCampaignStructure({
      campaignName: "Five Dollar Test",
      leadType: "final_expense",
      licensedStates: ["AZ"],
      dailyBudgetCents: cents,
      creatives: [{ headline: "Coverage", primaryText: "Coverage options for Arizona residents." }],
    });
    expect(structure.adSet.daily_budget).toBe(500);
    expect(() => requireDailyBudgetCents(0)).toThrow("finite integer");
    expect(() => requireDailyBudgetCents(Number.NaN)).toThrow("finite integer");
  });

  test("locked targeting is feed-only and explicitly disables Advantage+ Audience", () => {
    const targeting = buildMetaStateTargeting(["AZ"]);
    expect(targeting.publisher_platforms).toEqual(["facebook", "instagram"]);
    expect(targeting.facebook_positions).toEqual(["feed"]);
    expect(targeting.instagram_positions).toEqual(["stream"]);
    expect(targeting.targeting_automation).toEqual({ advantage_audience: 0 });
  });

  test("17 selected states produce exactly 17 unique Meta region keys", () => {
    const targeting = buildMetaStateTargeting(SEVENTEEN_STATES);
    const keys = targeting.geo_locations.regions.map((region) => region.key);
    expect(keys).toHaveLength(17);
    expect(new Set(keys).size).toBe(17);
    expect(keys).toEqual(SEVENTEEN_STATES.map((state) => META_REGION_MAP[state]));
  });

  test("unmapped or fake states are rejected with the offending state named", () => {
    expect(() => buildMetaStateTargeting(["AZ", "ZZ"])).toThrow("ZZ");
  });

  test("DC resolves to its Meta region key instead of being silently dropped", () => {
    expect(buildMetaStateTargeting(["DC"]).geo_locations.regions).toEqual([{ key: "3851" }]);
  });

  test("exact-match reuse performs readback verification and accepts order-independent regions", async () => {
    const expectedTargeting = buildMetaStateTargeting(SEVENTEEN_STATES);
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        daily_budget: "500",
        targeting: {
          ...expectedTargeting,
          geo_locations: {
            ...expectedTargeting.geo_locations,
            regions: [...expectedTargeting.geo_locations.regions].reverse(),
          },
        },
      }),
    });

    await expect(verifyMetaAdset({
      metaAdsetId: "adset-1",
      accessToken: "token",
      expectedDailyBudgetCents: 500,
      expectedTargeting,
      fetchImpl: fetchImpl as any,
    })).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain("daily_budget%2Ctargeting%2Coptimization_goal");
  });

  test("readback budget mismatch fails loudly instead of reporting launch success", async () => {
    const expectedTargeting = buildMetaStateTargeting(["AZ"]);
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        daily_budget: "2500",
        targeting: expectedTargeting,
      }),
    });

    await expect(verifyMetaAdset({
      metaAdsetId: "adset-1",
      accessToken: "token",
      expectedDailyBudgetCents: 500,
      expectedTargeting,
      fetchImpl: fetchImpl as any,
    })).rejects.toThrow("expected daily_budget=500, got 2500");
  });

  test("readback region mismatch names expected and actual region keys", async () => {
    const expectedTargeting = buildMetaStateTargeting(SEVENTEEN_STATES);
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        daily_budget: "500",
        targeting: buildMetaStateTargeting(SEVENTEEN_STATES.slice(0, 16)),
      }),
    });

    await expect(verifyMetaAdset({
      metaAdsetId: "adset-1",
      accessToken: "token",
      expectedDailyBudgetCents: 500,
      expectedTargeting,
      fetchImpl: fetchImpl as any,
    })).rejects.toThrow("expected region keys");
  });

  test("readback fails when Meta drops detailed audience interests", () => {
    const expectedTargeting = {
      ...buildMetaStateTargeting(["AZ"]),
      flexible_spec: [{ interests: [{ id: "6003141785766", name: "Mortgage loans" }] }],
    };
    expect(() => assertMetaAdsetMatches({
      actual: { daily_budget: "500", targeting: buildMetaStateTargeting(["AZ"]) },
      expectedDailyBudgetCents: 500,
      expectedTargeting,
    })).toThrow("interestGroups");
  });

  test("readback fails when Meta drops the website Lead dataset or conversion event", () => {
    const expectedTargeting = buildMetaStateTargeting(["AZ"]);
    expect(() => assertMetaAdsetMatches({
      actual: {
        daily_budget: "500",
        targeting: expectedTargeting,
        optimization_goal: "LEAD_GENERATION",
        billing_event: "IMPRESSIONS",
        destination_type: "WEBSITE",
        promoted_object: { page_id: "page-1" },
      },
      expectedDailyBudgetCents: 500,
      expectedTargeting,
      expected: {
        optimizationGoal: "LEAD_GENERATION",
        billingEvent: "IMPRESSIONS",
        destinationType: "WEBSITE",
        promotedObject: { page_id: "page-1", pixel_id: "725252660577483", custom_event_type: "LEAD" },
      },
    })).toThrow("promoted_object.pixel_id");
  });

  describe("attribution read-back normalization", () => {
    const expectedTargeting = buildMetaStateTargeting(["AZ"]);
    const nativeAttribution = [
      { event_type: "CLICK_THROUGH", window_days: 1 },
      { event_type: "VIEW_THROUGH", window_days: 0 },
    ];
    const hostedAttribution = [
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ];
    const verifyAttribution = (actualAttribution: Array<Record<string, unknown>>, expectedAttribution = nativeAttribution) => assertMetaAdsetMatches({
      actual: { daily_budget: "500", targeting: expectedTargeting, attribution_spec: actualAttribution },
      expectedDailyBudgetCents: 500,
      expectedTargeting,
      expected: { attributionSpec: expectedAttribution },
    });

    test("accepts Meta omitting only the native zero-day view entry", () => {
      expect(() => verifyAttribution([
        { event_type: "CLICK_THROUGH", window_days: 1 },
      ])).not.toThrow();
    });

    test("accepts Meta explicitly returning native one-day click and zero-day view", () => {
      expect(() => verifyAttribution(nativeAttribution)).not.toThrow();
    });

    test("rejects a non-zero native view window", () => {
      expect(() => verifyAttribution([
        { event_type: "CLICK_THROUGH", window_days: 1 },
        { event_type: "VIEW_THROUGH", window_days: 1 },
      ])).toThrow("attribution_spec");
    });

    test("rejects a wrong or missing native click window", () => {
      expect(() => verifyAttribution([
        { event_type: "CLICK_THROUGH", window_days: 7 },
      ])).toThrow("attribution_spec");
      expect(() => verifyAttribution([])).toThrow("attribution_spec");
    });

    test("keeps hosted seven-day click and one-day view verification unchanged", () => {
      expect(() => verifyAttribution(hostedAttribution, hostedAttribution)).not.toThrow();
      expect(() => verifyAttribution([
        { event_type: "CLICK_THROUGH", window_days: 7 },
      ], hostedAttribution)).toThrow("attribution_spec");
    });
  });
});
