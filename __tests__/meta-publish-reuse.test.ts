import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/facebook/publish-ad";
import { getServerSession } from "next-auth/next";
import User from "@/models/User";
import Folder from "@/models/Folder";
import { validateLaunchInput } from "@/pages/api/facebook/validate-launch";
import { checkMetaWriteReadiness } from "@/lib/meta/metaHealth";
import { claimLaunchCampaign, releaseLaunchCampaignClaim } from "@/lib/facebook/claimLaunchCampaign";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("@/pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));
jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/pages/api/facebook/validate-launch", () => ({
  validateLaunchInput: jest.fn(),
}));
jest.mock("@/lib/meta/metaHealth", () => ({
  checkMetaWriteReadiness: jest.fn(),
  markMetaHealthFailure: jest.fn(),
}));
jest.mock("@/lib/facebook/claimLaunchCampaign", () => ({
  claimLaunchCampaign: jest.fn(),
  releaseLaunchCampaignClaim: jest.fn(),
}));
jest.mock("@/models/User", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock("@/models/Folder", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() },
}));
jest.mock("@/models/FBLeadCampaign", () => ({
  __esModule: true,
  default: { updateOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

function selectedLean(value: unknown) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

describe("publish-ad exact-match reuse", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: "agent@example.com" } });
    (User.findOne as jest.Mock).mockReturnValue(selectedLean({
      _id: "user-1",
      email: "agent@example.com",
      name: "Agent",
      agentPhone: "+16025550199",
      metaAdAccountId: "123",
      metaPageId: "page-1",
    }));
    (Folder.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: "folder-1" }) });
    (checkMetaWriteReadiness as jest.Mock).mockResolvedValue({ ok: true });
    (releaseLaunchCampaignClaim as jest.Mock).mockResolvedValue(undefined);
  });

  test("blocks a one-ad veteran set when a stale client selected only a graphic treatment", async () => {
    const { req, res } = createMocks({
      method: "POST",
      body: {
        leadType: "veteran",
        audienceSegment: "standard",
        campaignType: "hosted_funnel",
        campaignName: "Veteran Coverage Campaign",
        dailyBudgetCents: 500,
        primaryText: "Review private life insurance coverage options for veterans.",
        headline: "Life Insurance For Veterans",
        cta: "LEARN_MORE",
        renderedCreativeDataUrl: "data:image/png;base64,AAAA",
        licensedStates: ["AZ"],
        stateRestrictionNoticeAccepted: true,
        drafts: [{
          leadType: "veteran",
          visualTreatment: "graphic",
          primaryText: "Review private life insurance coverage options for veterans.",
          headline: "Life Insurance For Veterans",
          cta: "LEARN_MORE",
          renderedCreativeDataUrl: "data:image/png;base64,AAAA",
        }],
      },
    });

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res._getData()).error).toContain("required photo/graphic mix");
    expect(validateLaunchInput).not.toHaveBeenCalled();
  });

  test("an exact published fingerprint verifies the live Meta ad set before returning reuse success", async () => {
    const targeting = {
      geo_locations: { regions: [{ key: "3845" }], location_types: ["home"] },
      targeting_automation: { advantage_audience: 0 },
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["feed"],
      instagram_positions: ["stream"],
    };
    (validateLaunchInput as jest.Mock).mockResolvedValue({
      accessToken: "test-token",
      adAccountId: "123",
      pageId: "page-1",
      licensedStates: ["AZ"],
      structure: {
        campaign: {
          name: "Final Expense - Arizona Campaign",
          objective: "OUTCOME_LEADS",
          buying_type: "AUCTION",
          status: "PAUSED",
          special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"],
        },
        adSet: {
          name: "Final Expense - Arizona Campaign Ad Set",
          daily_budget: 500,
          billing_event: "IMPRESSIONS",
          optimization_goal: "LEAD_GENERATION",
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          status: "PAUSED",
          targeting,
        },
        ads: [{ name: "Ad 1" }],
      },
    });
    (claimLaunchCampaign as jest.Mock).mockResolvedValue({
      launchClaimToken: "claim-1",
      campaign: {
        _id: "campaign-1",
        metaCampaignId: "meta-campaign-1",
        metaAdsetId: "meta-adset-1",
        metaAdId: "meta-ad-1",
        ads: [{ metaAdId: "meta-ad-1" }],
      },
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        daily_budget: "500",
        targeting: { geo_locations: { regions: [{ key: "3845" }] } },
      }),
    });
    global.fetch = fetchMock as any;

    const { req, res } = createMocks({
      method: "POST",
      body: {
        leadType: "final_expense",
        audienceSegment: "standard",
        campaignType: "hosted_funnel",
        campaignName: "Final Expense - Arizona Campaign",
        dailyBudgetCents: 500,
        primaryText: "Review final expense coverage options in Arizona.",
        headline: "Final Expense Coverage",
        cta: "LEARN_MORE",
        renderedCreativeDataUrl: "data:image/png;base64,AAAA",
        licensedStates: ["AZ"],
        stateRestrictionNoticeAccepted: true,
        funnelType: "lead_form",
      },
    });

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res._getData())).toEqual(expect.objectContaining({
      ok: true,
      alreadyPublished: true,
      verifiedMetaAdset: true,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/meta-adset-1?");
    expect(releaseLaunchCampaignClaim).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: "campaign-1",
      launchClaimToken: "claim-1",
    }));
  });
});
