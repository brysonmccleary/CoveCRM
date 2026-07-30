import {
  buildInsuranceAdAccountName,
  buildMetaPaymentUrl,
  getMetaTimezoneId,
  provisionMetaAdAccount,
} from "@/lib/meta/adAccountProvisioning";

function client(overrides: {
  get?: (path: string, fields: string) => Promise<any>;
  post?: (path: string, params: Record<string, string>) => Promise<any>;
}) {
  return {
    get: overrides.get || (async () => ({ data: [] })),
    post: overrides.post || (async () => ({})),
  };
}

const input = {
  token: "test-token",
  pageId: "page-1",
  pageName: "Your Life Quotes",
  userName: "Test User",
  userEmail: "test@example.com",
  browserTimeZone: "America/Phoenix",
};

describe("Meta ad-account provisioning", () => {
  test("uses a legitimate insurance Page brand and rejects generated slot names", () => {
    expect(buildInsuranceAdAccountName("My Affordable Final Expense")).toBe("My Affordable Final Expense");
    expect(buildInsuranceAdAccountName("Sitka Life")).toBe("Sitka Life");
    expect(buildInsuranceAdAccountName("AI Slot 14")).toBe("My Insurance Quotes");
    expect(buildInsuranceAdAccountName("Bryson McCleary")).toBe("My Insurance Quotes");
  });

  test("uses the customer's browser timezone and builds account-specific billing URL", () => {
    expect(getMetaTimezoneId("America/Phoenix")).toBe(5);
    const url = new URL(buildMetaPaymentUrl("act_123", "456"));
    expect(url.searchParams.get("payment_account_id")).toBe("123");
    expect(url.searchParams.get("asset_id")).toBe("123");
    expect(url.searchParams.get("business_id")).toBe("456");
    expect(url.pathname).toContain("billing_hub/accounts/details");
  });

  test("keeps an already selected active account and does not create another", async () => {
    const post = jest.fn();
    const result = await provisionMetaAdAccount(
      { ...input, currentAdAccountId: "111" },
      client({
        get: async (path) => {
          if (path === "me/adaccounts") return { data: [{ id: "act_111", account_id: "111", name: "Life Quotes", account_status: 1, business: { id: "biz-1" } }] };
          return { id: "act_111", account_id: "111", name: "Life Quotes", account_status: 1, funding_source: "card", business: { id: "biz-1" }, business_name: "Life Quotes LLC" };
        },
        post,
      }) as any
    );
    expect(result.status).toBe("ready");
    expect(result.adAccount?.accountId).toBe("111");
    expect(post).not.toHaveBeenCalled();
  });

  test("recovers and renames an owned CoveCRM account instead of creating a duplicate", async () => {
    const post = jest.fn(async () => ({ success: true }));
    const result = await provisionMetaAdAccount(input, client({
      get: async (path) => {
        if (path === "me/adaccounts") return { data: [] };
        if (path === "me/businesses") return { data: [{ id: "biz-1", name: "Test", timezone_id: 5, primary_page: { id: "page-1" } }] };
        if (path === "biz-1/owned_ad_accounts") return { data: [{ id: "act_222", account_id: "222", name: "CoveCRM", account_status: 1 }] };
        if (path === "act_222") return { id: "act_222", account_id: "222", name: "Your Life Quotes", account_status: 1 };
        return { data: [] };
      },
      post,
    }) as any);
    expect(result.adAccount?.accountId).toBe("222");
    expect(result.paymentRequired).toBe(true);
    expect(post).toHaveBeenCalledWith("act_222", { name: "Your Life Quotes" });
    expect(post).not.toHaveBeenCalledWith("biz-1/adaccount", expect.anything());
  });

  test("creates exactly one cleanly named account when the business owns none", async () => {
    const post = jest.fn(async (path: string) => path === "biz-1/adaccount" ? { id: "act_333" } : {});
    const result = await provisionMetaAdAccount(input, client({
      get: async (path) => {
        if (path === "me/adaccounts") return { data: [] };
        if (path === "me/businesses") return { data: [{ id: "biz-1", name: "Test", timezone_id: 5, primary_page: { id: "page-1" } }] };
        if (path === "biz-1/owned_ad_accounts") return { data: [] };
        if (path === "act_333") return { id: "act_333", account_id: "333", name: "Your Life Quotes", account_status: 1 };
        return { data: [] };
      },
      post,
    }) as any);
    expect(result.createdAdAccount).toBe(true);
    expect(post).toHaveBeenCalledWith("biz-1/adaccount", expect.objectContaining({ name: "Your Life Quotes", currency: "USD", timezone_id: "5" }));
  });
});
