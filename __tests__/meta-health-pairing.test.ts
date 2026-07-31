import { checkMetaWriteReadiness } from "@/lib/meta/metaHealth";
import User from "@/models/User";

jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/models/FBLeadCampaign", () => ({
  __esModule: true,
  default: { updateMany: jest.fn() },
}));
jest.mock("@/models/User", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findById: jest.fn(), updateOne: jest.fn() },
}));

const user = {
  _id: "user-1",
  email: "agent@example.com",
  metaAccessToken: "token",
  metaPageId: "page-1",
  metaAdAccountId: "123",
};

function graphResponse(data: any) {
  return { ok: true, json: async () => data } as Response;
}

describe("Meta Page/ad-account readiness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (User.updateOne as jest.Mock).mockResolvedValue({ acknowledged: true });
  });

  test("rejects a Page and ad account that are individually accessible but not connected", async () => {
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/me/accounts")) return graphResponse({ data: [{ id: "page-1", tasks: ["ADVERTISE"] }] });
      if (url.includes("/me/adaccounts")) return graphResponse({ data: [{ id: "act_123", account_id: "123", account_status: 1 }] });
      if (url.includes("/act_123/promote_pages")) return graphResponse({ data: [] });
      return graphResponse({ account_status: 1, disable_reason: 0, funding_source: "card" });
    }) as jest.Mock;

    const result = await checkMetaWriteReadiness({ user, force: true, requireLeadAdsEligibility: false });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("missingPageAdAccountConnection");
    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: "user-1" },
      { $set: expect.objectContaining({ metaHealthPageId: "page-1", metaHealthAdAccountId: "123" }) }
    );
  });

  test("marks the exact connected pair healthy", async () => {
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/me/accounts")) return graphResponse({ data: [{ id: "page-1", tasks: ["ADVERTISE"] }] });
      if (url.includes("/me/adaccounts")) return graphResponse({ data: [{ id: "act_123", account_id: "123", account_status: 1 }] });
      if (url.includes("/act_123/promote_pages")) return graphResponse({ data: [{ id: "page-1" }] });
      return graphResponse({ account_status: 1, disable_reason: 0, funding_source: "card" });
    }) as jest.Mock;

    const result = await checkMetaWriteReadiness({ user, force: true, requireLeadAdsEligibility: false });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: "user-1" },
      { $set: expect.objectContaining({ metaHealthPageId: "page-1", metaHealthAdAccountId: "123" }) }
    );
  });

  test("accepts a Page owned by the same business even when promote_pages is empty", async () => {
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/me/accounts")) return graphResponse({ data: [{ id: "page-1", tasks: ["ADVERTISE"] }] });
      if (url.includes("/me/adaccounts")) return graphResponse({ data: [{ id: "act_123", account_id: "123", account_status: 1, business: { id: "biz-1" } }] });
      if (url.includes("/biz-1/owned_pages")) return graphResponse({ data: [{ id: "page-1" }] });
      if (url.includes("/biz-1/client_pages")) return graphResponse({ data: [] });
      if (url.includes("/act_123/promote_pages")) return graphResponse({ data: [] });
      return graphResponse({ account_status: 1, disable_reason: 0, funding_source: "card", business: { id: "biz-1" } });
    }) as jest.Mock;

    const result = await checkMetaWriteReadiness({ user, force: true, requireLeadAdsEligibility: false });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("healthy");
  });
});
