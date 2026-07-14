import type { NextApiRequest, NextApiResponse } from "next";
import webhookHandler from "../pages/api/stripe/webhook";
import { stripe } from "@/lib/stripe";
import User from "@/models/User";

jest.mock("micro", () => ({
  buffer: jest.fn().mockResolvedValue(Buffer.from("{}")),
}));

jest.mock("@/lib/mongooseConnect", () => jest.fn());

jest.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: jest.fn() },
  },
}));

jest.mock("@/models/User", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

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

function checkoutSessionCompletedEvent(opts: { sessionId: string; email: string; amountUSD: number }) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: opts.sessionId,
        customer_email: opts.email,
        customer_details: { email: opts.email },
        amount_total: Math.round(opts.amountUSD * 100),
        metadata: { purpose: "ai_dialer_topup" },
      },
    },
  } as any;
}

const mockedStripe = stripe as unknown as { webhooks: { constructEvent: jest.Mock } };
const mockedUser = User as unknown as { findOne: jest.Mock; findOneAndUpdate: jest.Mock };

describe("Stripe ai_dialer_topup idempotency", () => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  afterAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });

  test("replaying the same checkout session only credits the balance once", async () => {
    const email = "agent@example.com";
    const sessionId = "cs_test_replayed_session";

    // In-memory doc that behaves like the real Mongo document would under
    // the atomic { $ne: s.id } guard: a session id can only ever apply once.
    const userDoc: any = {
      email,
      aiDialerBalance: 10,
      aiDialerCreditedSessionIds: [] as string[],
    };

    mockedUser.findOne.mockResolvedValue(userDoc);
    mockedUser.findOneAndUpdate.mockImplementation(async (filter: any, update: any) => {
      const alreadyCredited = userDoc.aiDialerCreditedSessionIds.includes(filter.aiDialerCreditedSessionIds.$ne);
      if (alreadyCredited) return null; // mirrors Mongo: filter no longer matches, zero docs updated
      userDoc.aiDialerBalance += update.$inc.aiDialerBalance;
      userDoc.aiDialerCreditedSessionIds.push(filter.aiDialerCreditedSessionIds.$ne);
      return { ...userDoc };
    });

    const event = checkoutSessionCompletedEvent({ sessionId, email, amountUSD: 25 });
    mockedStripe.webhooks.constructEvent.mockReturnValue(event);

    // First delivery — should credit.
    const first = mockReqRes();
    await webhookHandler(first.req, first.res);
    expect(first.res.statusCode).toBeLessThan(400);
    expect(userDoc.aiDialerBalance).toBe(35);
    expect(userDoc.aiDialerCreditedSessionIds).toEqual([sessionId]);

    // Simulated Stripe retry of the exact same event/session — must NOT credit again.
    const second = mockReqRes();
    await webhookHandler(second.req, second.res);
    expect(second.res.statusCode).toBeLessThan(400);

    expect(userDoc.aiDialerBalance).toBe(35); // unchanged after the "retry"
    expect(mockedUser.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(mockedUser.findOneAndUpdate).toHaveBeenCalledWith(
      { email, aiDialerCreditedSessionIds: { $ne: sessionId } },
      expect.objectContaining({
        $inc: { aiDialerBalance: 25 },
        $addToSet: { aiDialerCreditedSessionIds: sessionId },
      }),
      { new: true },
    );
  });

  test("two different checkout sessions for the same user both credit independently", async () => {
    const email = "agent2@example.com";
    const userDoc: any = { email, aiDialerBalance: 0, aiDialerCreditedSessionIds: [] as string[] };

    mockedUser.findOne.mockResolvedValue(userDoc);
    mockedUser.findOneAndUpdate.mockImplementation(async (filter: any, update: any) => {
      const already = userDoc.aiDialerCreditedSessionIds.includes(filter.aiDialerCreditedSessionIds.$ne);
      if (already) return null;
      userDoc.aiDialerBalance += update.$inc.aiDialerBalance;
      userDoc.aiDialerCreditedSessionIds.push(filter.aiDialerCreditedSessionIds.$ne);
      return { ...userDoc };
    });

    mockedStripe.webhooks.constructEvent.mockReturnValueOnce(
      checkoutSessionCompletedEvent({ sessionId: "cs_a", email, amountUSD: 10 }),
    );
    await webhookHandler(...Object.values(mockReqRes()) as [NextApiRequest, NextApiResponse]);

    mockedStripe.webhooks.constructEvent.mockReturnValueOnce(
      checkoutSessionCompletedEvent({ sessionId: "cs_b", email, amountUSD: 15 }),
    );
    await webhookHandler(...Object.values(mockReqRes()) as [NextApiRequest, NextApiResponse]);

    expect(userDoc.aiDialerBalance).toBe(25);
    expect(userDoc.aiDialerCreditedSessionIds.sort()).toEqual(["cs_a", "cs_b"]);
  });
});
