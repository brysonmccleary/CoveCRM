import { preflightMetaLaunch } from "@/lib/facebook/metaLaunchPreflight";
import { buildCampaignStructure } from "@/lib/facebook/buildCampaignStructure";

function response(body: any, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: jest.fn().mockResolvedValue(body) } as any;
}

describe("Meta non-creating launch preflight", () => {
  const structure = buildCampaignStructure({
    campaignName: "Veteran IUL",
    leadType: "iul",
    audienceSegment: "veteran",
    licensedStates: ["AZ"],
    dailyBudgetCents: 500,
    creatives: [{ primaryText: "Veterans can review IUL cash value options.", headline: "Veteran IUL" }],
  });

  test("validates campaign and complete website ad-set payload without creating objects", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response({ data: [{
        id: "paused-financial-campaign",
        objective: "OUTCOME_LEADS",
        special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"],
      }] }))
      .mockResolvedValueOnce(response({ success: true }));
    await expect(preflightMetaLaunch({
      adAccountId: "act_123",
      accessToken: "token",
      campaign: structure.campaign,
      adSet: structure.adSet,
      pageId: "page-1",
      datasetId: "725252660577483",
      campaignType: "hosted_funnel",
      fetchImpl: fetchImpl as any,
    })).resolves.toEqual(expect.objectContaining({ ok: true, validationCampaignId: "paused-financial-campaign" }));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const campaignBody = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    expect(JSON.parse(String(campaignBody.get("execution_options")))).toEqual(["validate_only"]);
    expect(campaignBody.get("is_adset_budget_sharing_enabled")).toBe("false");
    const adSetBody = new URLSearchParams(fetchImpl.mock.calls[2][1].body);
    expect(JSON.parse(String(adSetBody.get("execution_options")))).toEqual(["validate_only"]);
    expect(JSON.parse(String(adSetBody.get("promoted_object")))).toEqual({
      page_id: "page-1",
      pixel_id: "725252660577483",
      custom_event_type: "LEAD",
    });
    expect(JSON.parse(String(adSetBody.get("targeting"))).flexible_spec).toEqual([
      { interests: [{ id: "6003353637860", name: "Life insurance" }] },
      { interests: [
        { id: "6003331621377", name: "Investment strategy" },
        { id: "6003293787730", name: "Investment management" },
      ] },
    ]);
    expect(JSON.parse(String(adSetBody.get("attribution_spec")))).toEqual([
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ]);
  });

  test("uses Meta's accepted 1-day click and 0-day view attribution for native Instant Forms", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response({ data: [{
        id: "paused-financial-campaign",
        objective: "OUTCOME_LEADS",
        special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"],
      }] }))
      .mockResolvedValueOnce(response({ success: true }));

    await preflightMetaLaunch({
      adAccountId: "123",
      accessToken: "token",
      campaign: structure.campaign,
      adSet: { ...structure.adSet, optimization_goal: "LEAD_GENERATION" },
      pageId: "page-1",
      campaignType: "native_form",
      fetchImpl: fetchImpl as any,
    });

    const adSetBody = new URLSearchParams(fetchImpl.mock.calls[2][1].body);
    expect(JSON.parse(String(adSetBody.get("attribution_spec")))).toEqual([
      { event_type: "CLICK_THROUGH", window_days: 1 },
      { event_type: "VIEW_THROUGH", window_days: 0 },
    ]);
    expect(JSON.parse(String(adSetBody.get("promoted_object")))).toEqual({ page_id: "page-1" });
    expect(adSetBody.get("destination_type")).toBe("ON_AD");
  });

  test("fails before campaign creation when Meta rejects the validate_only payload", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(response({
      error: { message: "Invalid targeting", error_user_msg: "This audience cannot be used" },
    }, false));
    await expect(preflightMetaLaunch({
      adAccountId: "123",
      accessToken: "token",
      campaign: structure.campaign,
      adSet: structure.adSet,
      pageId: "page-1",
      datasetId: "725252660577483",
      campaignType: "hosted_funnel",
      fetchImpl: fetchImpl as any,
    })).rejects.toThrow("This audience cannot be used");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("blocks website preflight when the Lead Pixel/dataset is missing", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response({ data: [{
        id: "paused-financial-campaign",
        objective: "OUTCOME_LEADS",
        special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"],
      }] }));
    await expect(preflightMetaLaunch({
      adAccountId: "123",
      accessToken: "token",
      campaign: structure.campaign,
      adSet: structure.adSet,
      pageId: "page-1",
      campaignType: "hosted_funnel",
      fetchImpl: fetchImpl as any,
    })).rejects.toThrow("requires a Pixel/dataset");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
