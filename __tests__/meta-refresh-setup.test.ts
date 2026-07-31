import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/meta/refresh-setup";
import { getServerSession } from "next-auth/next";
import User from "@/models/User";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("@/pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));
jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/models/User", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() },
}));

describe("automatic Meta setup refresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: "agent@example.com" } });
    (User.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        metaAccessToken: "user-token",
        metaPageId: "old-page",
        metaPageName: "Old Page",
        metaAdAccountId: "123",
      }),
    });
    (User.findOneAndUpdate as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ metaPageId: "new-page", metaAdAccountId: "123" }),
      }),
    });
  });

  it("detects, saves, and subscribes the one newly-created Page", async () => {
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/me/accounts")) {
        return { ok: true, json: async () => ({ data: [
          { id: "new-page", name: "Your Life Quotes", access_token: "page-token", tasks: ["ADVERTISE"] },
          { id: "old-page", name: "Old Page", access_token: "old-token", tasks: ["ADVERTISE"] },
        ] }) } as Response;
      }
      if (url.includes("/me/adaccounts")) {
        return { ok: true, json: async () => ({ data: [
          { id: "act_123", account_id: "123", name: "Main Ads", account_status: 1 },
        ] }) } as Response;
      }
      expect(url).toContain("/new-page/subscribed_apps");
      expect(init?.method).toBe("POST");
      return { ok: true, json: async () => ({ success: true }) } as Response;
    }) as jest.Mock;

    const { req, res } = createMocks({
      method: "POST",
      body: {
        preferNewPage: true,
        knownPageIds: ["old-page"],
        leadType: "final_expense",
      },
    });
    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res._getData())).toMatchObject({
      connected: true,
      ready: true,
      leadDeliveryReady: true,
      page: { id: "new-page", name: "Your Life Quotes" },
      adAccount: { accountId: "123" },
    });
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { email: "agent@example.com" },
      { $set: expect.objectContaining({
        metaPageId: "new-page",
        metaPageName: "Your Life Quotes",
        metaPageAccessToken: "page-token",
        metaAdAccountId: "123",
      }), $unset: { metaLeadTypeAssets: "" } },
      { new: true }
    );
  });

  it("detects and saves the newly-created active ad account", async () => {
    (User.findOneAndUpdate as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ metaPageId: "old-page", metaAdAccountId: "456" }),
      }),
    });
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/me/accounts")) {
        return { ok: true, json: async () => ({ data: [
          { id: "old-page", name: "Old Page", access_token: "page-token", tasks: ["ADVERTISE"] },
        ] }) } as Response;
      }
      if (url.includes("/me/adaccounts")) {
        return { ok: true, json: async () => ({ data: [
          { id: "act_123", account_id: "123", name: "Old Ads", account_status: 1 },
          { id: "act_456", account_id: "456", name: "New Ads", account_status: 1 },
        ] }) } as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    }) as jest.Mock;

    const { req, res } = createMocks({
      method: "POST",
      body: {
        preferNewAdAccount: true,
        knownAdAccountIds: ["123"],
        leadType: "final_expense",
      },
    });
    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res._getData())).toMatchObject({
      ready: true,
      adAccount: { accountId: "456", name: "New Ads", status: 1 },
    });
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { email: "agent@example.com" },
      { $set: expect.objectContaining({
        metaAdAccountId: "456",
      }), $unset: { metaLeadTypeAssets: "" } },
      { new: true }
    );
  });
});
