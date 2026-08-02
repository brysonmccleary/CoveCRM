import type { NextApiRequest, NextApiResponse } from "next";

// AI_PRICE_IDS (lib/billing/computeHasAIForCustomer.ts) and PLAN_PRICE_MAP
// (pages/api/stripe/webhook.ts) are both computed once from process.env at
// module-load time, so the relevant env vars must be set BEFORE the modules
// are required — hence jest.resetModules() + require() inside beforeAll
// rather than static top-level imports.
const LEGACY_PHONE_PRICE_ID = "price_phone_test";
const BASE_PLAN_PRICE_ID = "price_base_test";
const AI_PLAN_PRICE_ID = "price_ai_test";

let webhookHandler: typeof import("../pages/api/stripe/webhook").default;
let mockedStripe: { webhooks: { constructEvent: jest.Mock }; subscriptions: { list: jest.Mock } };
let mockedUser: { findOne: jest.Mock };

function mockReqRes() {
  const req = {
    method: "POST",
    headers: { "stripe-signature": "test-sig" },
  } as unknown as NextApiRequest;

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
    send: jest.fn(function send(this: any, payload?: unknown) {
      this.body = payload;
      return this;
    }),
  } as unknown as NextApiResponse & { statusCode: number; body: unknown };

  return { req, res };
}

function subscriptionUpdatedEvent(sub: any) {
  return { type: "customer.subscription.updated", data: { object: sub } } as any;
}

function grandfatheredUserDoc() {
  return {
    email: "grandfathered@example.com",
    stripeCustomerId: "cus_grandfathered",
    subscriptionStatus: "active",
    hasAI: true,
    aiEntitlementSource: "grandfathered",
    grandfatheredAI: true,
    planCode: "base",
    save: jest.fn(),
  };
}

describe("grandfathered AI survives customer.subscription.updated", () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.CoveCRM_Base = BASE_PLAN_PRICE_ID;
    process.env.CoveCRM_AI_Plan = AI_PLAN_PRICE_ID;
    process.env.STRIPE_PHONE_PRICE_ID = LEGACY_PHONE_PRICE_ID;
    // Deliberately leave STRIPE_PRICE_ID_AI_MONTHLY / AI_Upgrade / CoveCRM_AI_Annual_Plan
    // unset so computeHasAIForCustomer's AI_PRICE_IDS only contains AI_PLAN_PRICE_ID.

    jest.resetModules();

    jest.doMock("micro", () => ({
      buffer: jest.fn().mockResolvedValue(Buffer.from("{}")),
    }));
    jest.doMock("@/lib/mongooseConnect", () => jest.fn());
    jest.doMock("@/lib/stripe", () => ({
      stripe: {
        webhooks: { constructEvent: jest.fn() },
        subscriptions: { list: jest.fn() },
      },
    }));
    jest.doMock("@/models/User", () => ({
      __esModule: true,
      default: { findOne: jest.fn() },
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    webhookHandler = require("../pages/api/stripe/webhook").default;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mockedStripe = require("@/lib/stripe").stripe;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mockedUser = require("@/models/User").default;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("an unrelated phone-number subscription renewing does not clobber hasAI/aiEntitlementSource", async () => {
    const userDoc = grandfatheredUserDoc();
    mockedUser.findOne.mockResolvedValue(userDoc);

    // computeHasAIForCustomer's own subscriptions.list call (checking for a
    // paid AI item across ALL subs) — this customer has none.
    mockedStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          id: "sub_phone",
          status: "active",
          items: { data: [{ price: { id: LEGACY_PHONE_PRICE_ID } }] },
        },
      ],
    });

    // The event firing is the phone-number subscription itself (not in PLAN_PRICE_MAP).
    const firingSub = {
      id: "sub_phone",
      customer: "cus_grandfathered",
      status: "active",
      items: { data: [{ price: { id: LEGACY_PHONE_PRICE_ID } }] },
    };
    mockedStripe.webhooks.constructEvent.mockReturnValue(subscriptionUpdatedEvent(firingSub));

    const { req, res } = mockReqRes();
    await webhookHandler(req, res);

    expect(res.statusCode).toBeLessThan(400);
    // Phone renewals are unrelated to CRM access and must not write the CRM
    // user record at all (a previous implementation clobbered plan fields).
    expect(userDoc.save).not.toHaveBeenCalled();
    expect(userDoc.hasAI).toBe(true);
    expect(userDoc.aiEntitlementSource).toBe("grandfathered");
  });

  test("the user's own base-plan subscription renewing does not downgrade aiEntitlementSource to none", async () => {
    const userDoc = grandfatheredUserDoc();
    mockedUser.findOne.mockResolvedValue(userDoc);

    mockedStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          id: "sub_base",
          status: "active",
          items: { data: [{ price: { id: BASE_PLAN_PRICE_ID } }] },
        },
      ],
    });

    // This time the firing subscription IS their base plan — exercises the
    // second write site (mappedPlan.planCode === "base" branch).
    const firingSub = {
      id: "sub_base",
      customer: "cus_grandfathered",
      status: "active",
      items: { data: [{ price: { id: BASE_PLAN_PRICE_ID } }] },
    };
    mockedStripe.webhooks.constructEvent.mockReturnValue(subscriptionUpdatedEvent(firingSub));

    const { req, res } = mockReqRes();
    await webhookHandler(req, res);

    expect(res.statusCode).toBeLessThan(400);
    expect(userDoc.hasAI).toBe(true);
    expect(userDoc.aiEntitlementSource).toBe("grandfathered");
    expect(userDoc.planCode).toBe("base");
  });

  test("a non-grandfathered base-plan user's renewal still correctly resolves to no AI", async () => {
    const userDoc = {
      email: "ordinary@example.com",
      stripeCustomerId: "cus_ordinary",
      subscriptionStatus: "active",
      hasAI: false,
      aiEntitlementSource: "none",
      grandfatheredAI: false,
      planCode: "base",
      save: jest.fn(),
    };
    mockedUser.findOne.mockResolvedValue(userDoc);
    mockedStripe.subscriptions.list.mockResolvedValue({
      data: [{ id: "sub_base2", status: "active", items: { data: [{ price: { id: BASE_PLAN_PRICE_ID } }] } }],
    });

    const firingSub = {
      id: "sub_base2",
      customer: "cus_ordinary",
      status: "active",
      items: { data: [{ price: { id: BASE_PLAN_PRICE_ID } }] },
    };
    mockedStripe.webhooks.constructEvent.mockReturnValue(subscriptionUpdatedEvent(firingSub));

    const { req, res } = mockReqRes();
    await webhookHandler(req, res);

    expect(res.statusCode).toBeLessThan(400);
    expect(userDoc.hasAI).toBe(false);
    expect(userDoc.aiEntitlementSource).toBe("none");
  });
});
