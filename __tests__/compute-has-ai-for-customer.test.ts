// AI_PRICE_IDS in lib/billing/computeHasAIForCustomer.ts is computed once from
// process.env at module-load time, so the env vars must be set BEFORE the
// module is required — hence jest.resetModules() + require() in beforeAll
// rather than a static top-level import.
let computeHasAIForCustomer: typeof import("@/lib/billing/computeHasAIForCustomer").computeHasAIForCustomer;
let mockedList: jest.Mock;

describe("computeHasAIForCustomer", () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.STRIPE_PRICE_ID_AI_MONTHLY = "price_ai_monthly_legacy";
    process.env.AI_Upgrade = "price_ai_upgrade_new";
    process.env.CoveCRM_AI_Plan = "price_ai_plan_new";
    process.env.CoveCRM_AI_Annual_Plan = "price_ai_annual_new";

    jest.resetModules();
    jest.doMock("@/lib/stripe", () => ({
      stripe: { subscriptions: { list: jest.fn() } },
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    computeHasAIForCustomer = require("@/lib/billing/computeHasAIForCustomer").computeHasAIForCustomer;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mockedList = require("@/lib/stripe").stripe.subscriptions.list;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    mockedList.mockReset();
  });

  test("returns true when an active sub has an item on the legacy STRIPE_PRICE_ID_AI_MONTHLY price", async () => {
    mockedList.mockResolvedValue({
      data: [{ status: "active", items: { data: [{ price: { id: "price_ai_monthly_legacy" } }] } }],
    });
    await expect(computeHasAIForCustomer("cus_1")).resolves.toBe(true);
  });

  test("returns true when an active sub has an item on the newer AI_Upgrade price (regression for the env-var gap)", async () => {
    mockedList.mockResolvedValue({
      data: [{ status: "active", items: { data: [{ price: { id: "price_ai_upgrade_new" } }] } }],
    });
    await expect(computeHasAIForCustomer("cus_1")).resolves.toBe(true);
  });

  test("returns true when an active sub has an item on CoveCRM_AI_Plan", async () => {
    mockedList.mockResolvedValue({
      data: [{ status: "active", items: { data: [{ price: { id: "price_ai_plan_new" } }] } }],
    });
    await expect(computeHasAIForCustomer("cus_1")).resolves.toBe(true);
  });

  test("returns false when the only active subscription is an unrelated phone-number price", async () => {
    mockedList.mockResolvedValue({
      data: [{ status: "active", items: { data: [{ price: { id: "price_phone_number" } }] } }],
    });
    await expect(computeHasAIForCustomer("cus_1")).resolves.toBe(false);
  });

  test("ignores a canceled subscription even if it has an AI-priced item", async () => {
    mockedList.mockResolvedValue({
      data: [{ status: "canceled", items: { data: [{ price: { id: "price_ai_monthly_legacy" } }] } }],
    });
    await expect(computeHasAIForCustomer("cus_1")).resolves.toBe(false);
  });

  test("returns false on a Stripe API error", async () => {
    mockedList.mockRejectedValue(new Error("stripe down"));
    await expect(computeHasAIForCustomer("cus_1")).resolves.toBe(false);
  });

  test("returns false with no customerId", async () => {
    await expect(computeHasAIForCustomer("")).resolves.toBe(false);
    expect(mockedList).not.toHaveBeenCalled();
  });
});
