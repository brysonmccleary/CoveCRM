import type { NextApiRequest, NextApiResponse } from "next";

// ADMIN_FREE_AI_EMAILS/ACTIVATION_ENFORCEMENT_STARTED_AT in
// pages/api/create-subscription.ts are computed once from process.env at
// module-load time, so required env vars must be set BEFORE the handler is
// required — hence jest.resetModules() + require() in beforeAll.
let handler: typeof import("../pages/api/create-subscription").default;
let mockedStripe: {
  customers: { retrieve: jest.Mock };
  subscriptions: { list: jest.Mock };
  setupIntents: { create: jest.Mock };
};
let mockedUser: { findOne: jest.Mock; updateOne: jest.Mock };
let mockedGetServerSession: jest.Mock;

const BASE_PRICE_ID = "price_base_test";

function mockReqRes(body: any) {
  const req = { method: "POST", body } as unknown as NextApiRequest;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: jest.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(this: any, payload: unknown) {
      this.body = payload;
      return this;
    }),
    end: jest.fn(),
  } as unknown as NextApiResponse & { statusCode: number; body: unknown };
  return { req, res };
}

describe("create-subscription.ts does not clobber a grandfathered user's hasAI on a card update", () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.CoveCRM_Base = BASE_PRICE_ID;
    process.env.CoveCRM_AI_Plan = "price_ai_plan_test";
    process.env.CoveCRM_AI_Annual_Plan = "price_ai_annual_test";
    process.env.CoveCRM_Annual_Base_Plan = "price_base_annual_test";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

    jest.resetModules();

    jest.doMock("@/lib/mongooseConnect", () => jest.fn());
    jest.doMock("@/lib/billing/assertStripeWritesEnabled", () => ({
      assertStripeWritesEnabled: jest.fn(),
    }));
    jest.doMock("next-auth/next", () => ({ getServerSession: jest.fn() }));
    jest.doMock("../pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));
    jest.doMock("@/lib/stripe", () => ({
      stripe: {
        customers: { retrieve: jest.fn() },
        subscriptions: { list: jest.fn() },
        setupIntents: { create: jest.fn() },
      },
    }));
    jest.doMock("@/models/User", () => ({
      __esModule: true,
      default: { findOne: jest.fn(), updateOne: jest.fn() },
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    handler = require("../pages/api/create-subscription").default;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mockedStripe = require("@/lib/stripe").stripe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mockedUser = require("@/models/User").default;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mockedGetServerSession = require("next-auth/next").getServerSession;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("SetupIntent/reusable-subscription path (as triggered by a card update) preserves hasAI for a grandfathered user", async () => {
    const email = "grandfathered@example.com";
    const userDoc: any = {
      _id: "user_gf_1",
      email,
      role: "user",
      emailVerified: true,
      stripeCustomerId: "cus_gf_1",
      hasAI: true,
      aiEntitlementSource: "grandfathered",
      grandfatheredAI: true,
      planCode: "base",
      billingInterval: "monthly",
      save: jest.fn(),
    };

    mockedGetServerSession.mockResolvedValue({ user: { email } });
    mockedUser.findOne.mockResolvedValue(userDoc);
    mockedUser.updateOne.mockResolvedValue({ modifiedCount: 1 });

    mockedStripe.customers.retrieve.mockResolvedValue({ id: "cus_gf_1" });

    // One existing active subscription on the (non-AI) base price — this is
    // both the "reusable" subscription create-subscription.ts finds AND the
    // only subscription computeHasAIForCustomer sees when checking for a
    // paid AI item (there is none here).
    mockedStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          id: "sub_gf_1",
          status: "active",
          latest_invoice: null,
          pending_setup_intent: null,
          items: { data: [{ price: { id: BASE_PRICE_ID } }] },
        },
      ],
    });
    mockedStripe.setupIntents.create.mockResolvedValue({ client_secret: "seti_test_secret" });

    const { req, res } = mockReqRes({ email, planCode: "base", interval: "monthly" });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockedUser.updateOne).toHaveBeenCalledWith(
      { _id: "user_gf_1" },
      {
        $set: expect.objectContaining({
          hasAI: true,
          aiEntitlementSource: "grandfathered",
        }),
      },
    );
  });

  test("an ordinary (non-grandfathered) base-plan user's card update still correctly resolves to no AI", async () => {
    const email = "ordinary@example.com";
    const userDoc: any = {
      _id: "user_ord_1",
      email,
      role: "user",
      emailVerified: true,
      stripeCustomerId: "cus_ord_1",
      hasAI: false,
      aiEntitlementSource: "none",
      grandfatheredAI: false,
      planCode: "base",
      billingInterval: "monthly",
      save: jest.fn(),
    };

    mockedGetServerSession.mockResolvedValue({ user: { email } });
    mockedUser.findOne.mockResolvedValue(userDoc);
    mockedUser.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockedStripe.customers.retrieve.mockResolvedValue({ id: "cus_ord_1" });
    mockedStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          id: "sub_ord_1",
          status: "active",
          latest_invoice: null,
          pending_setup_intent: null,
          items: { data: [{ price: { id: BASE_PRICE_ID } }] },
        },
      ],
    });
    mockedStripe.setupIntents.create.mockResolvedValue({ client_secret: "seti_test_secret_2" });

    const { req, res } = mockReqRes({ email, planCode: "base", interval: "monthly" });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockedUser.updateOne).toHaveBeenCalledWith(
      { _id: "user_ord_1" },
      {
        $set: expect.objectContaining({
          hasAI: false,
          aiEntitlementSource: "none",
        }),
      },
    );
  });
});
