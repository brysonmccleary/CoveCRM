import fs from "fs";
import path from "path";
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import processAffiliatePayouts from "../pages/api/cron/process-affiliate-payouts";
import payoutAll from "../pages/api/affiliate/payout-all";
import watchdog from "../pages/api/ai-calls/watchdog";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayoutLedger from "@/models/AffiliatePayoutLedger";
import AICallSession from "@/models/AICallSession";
import AICallUsageLedger from "@/models/AICallUsageLedger";
import BillingEvent from "@/models/BillingEvent";
import UsageAccrualLedger from "@/models/UsageAccrualLedger";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

jest.mock("next-auth/next", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("../pages/api/auth/[...nextauth]", () => ({
  authOptions: {},
}));

jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/lib/billing/assertStripeWritesEnabled", () => ({
  assertStripeWritesEnabled: jest.fn(),
}));

jest.mock("@/lib/stripe", () => ({
  stripe: {
    transfers: {
      create: jest.fn(),
    },
    invoices: {
      retrieve: jest.fn(),
    },
  },
}));

jest.mock("@/models/Affiliate", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
  },
}));

jest.mock("@/models/AffiliatePayoutLedger", () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock("@/models/User", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    find: jest.fn(),
    aggregate: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock("@/models/UsageAccrualLedger", () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn(),
  },
}));

jest.mock("@/models/AICallSession", () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock("@/models/AICallUsageLedger", () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock("@/models/BillingEvent", () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    updateOne: jest.fn(),
  },
}));

function mockReqRes({
  method = "POST",
  headers = {},
}: {
  method?: string;
  headers?: Record<string, string>;
} = {}) {
  const req = {
    method,
    headers,
    query: {},
    body: {},
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
    end: jest.fn(function end(this: any, payload?: unknown) {
      this.body = payload;
      return this;
    }),
  } as unknown as NextApiResponse & { statusCode: number; body: any };

  return { req, res };
}

function leanChain(value: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function execChain(value: unknown) {
  return {
    exec: jest.fn().mockResolvedValue(value),
  };
}

const mockedGetServerSession = getServerSession as jest.Mock;
const mockedDbConnect = dbConnect as jest.Mock;
const mockedAffiliate = Affiliate as unknown as { findById: jest.Mock };
const mockedLedger = AffiliatePayoutLedger as unknown as {
  aggregate: jest.Mock;
  find: jest.Mock;
  findOneAndUpdate: jest.Mock;
};
const mockedUser = User as unknown as {
  findById: jest.Mock;
  find: jest.Mock;
  aggregate: jest.Mock;
  updateOne: jest.Mock;
};
const mockedUsageAccrualLedger = UsageAccrualLedger as unknown as {
  aggregate: jest.Mock;
};
const mockedSession = AICallSession as unknown as {
  find: jest.Mock;
  updateOne: jest.Mock;
};
const mockedAiCallUsageLedger = AICallUsageLedger as unknown as {
  find: jest.Mock;
  updateOne: jest.Mock;
};
const mockedBillingEvent = BillingEvent as unknown as {
  find: jest.Mock;
  updateOne: jest.Mock;
};
const mockedStripe = stripe as unknown as {
  transfers: { create: jest.Mock };
  invoices: { retrieve: jest.Mock };
};

describe("payout double-pay remediation", () => {
  const originalEnv = {
    COVECRM_API_SECRET: process.env.COVECRM_API_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    AFFILIATE_PAYOUTS_ENABLED: process.env.AFFILIATE_PAYOUTS_ENABLED,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    AI_DIALER_CRON_KEY: process.env.AI_DIALER_CRON_KEY,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDbConnect.mockResolvedValue(undefined);
    mockedGetServerSession.mockResolvedValue(null);
    process.env.COVECRM_API_SECRET = "cron-secret";
    process.env.CRON_SECRET = "cron-secret";
    process.env.AFFILIATE_PAYOUTS_ENABLED = "1";
    process.env.ADMIN_EMAILS = "admin@example.com";
    process.env.AI_DIALER_CRON_KEY = "cron-secret";
  });

  afterAll(() => {
    process.env.COVECRM_API_SECRET = originalEnv.COVECRM_API_SECRET;
    process.env.CRON_SECRET = originalEnv.CRON_SECRET;
    process.env.AFFILIATE_PAYOUTS_ENABLED = originalEnv.AFFILIATE_PAYOUTS_ENABLED;
    process.env.ADMIN_EMAILS = originalEnv.ADMIN_EMAILS;
    process.env.AI_DIALER_CRON_KEY = originalEnv.AI_DIALER_CRON_KEY;
  });

  test("same ledger entry processed twice creates exactly one Stripe transfer", async () => {
    const credit: any = {
      _id: "ledger1",
      affiliateId: "aff1",
      userId: "user1",
      month: "2026-07",
      amountCents: 1250,
      stripeInvoiceId: "in_1",
      status: "held",
      save: jest.fn().mockResolvedValue(undefined),
    };
    const affiliate = {
      _id: "aff1",
      userId: "owner1",
      stripeConnectId: "acct_1",
      onboardingCompleted: true,
      approved: true,
    };

    mockedLedger.aggregate.mockResolvedValue([{ _id: "aff1", totalCents: 1250, count: 1 }]);
    mockedAffiliate.findById.mockResolvedValue(affiliate);
    mockedUser.findById.mockReturnValue(leanChain({ subscriptionStatus: "active", billingBlocked: false }));
    mockedLedger.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([credit]),
      }),
    });
    mockedLedger.findOneAndUpdate.mockImplementation(async () => {
      if (credit.status !== "held") return null;
      credit.status = "processing";
      return credit;
    });
    mockedStripe.transfers.create.mockResolvedValue({ id: "tr_1" });

    const first = mockReqRes({ headers: { "x-api-secret": "cron-secret" } });
    await processAffiliatePayouts(first.req, first.res);
    const second = mockReqRes({ headers: { "x-api-secret": "cron-secret" } });
    await processAffiliatePayouts(second.req, second.res);

    expect(mockedStripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(mockedStripe.transfers.create).toHaveBeenCalledWith(
      expect.any(Object),
      { idempotencyKey: "payout:ledger1" },
    );
  });

  test("webhook affiliate payout replay uses one ledger upsert path", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "pages/api/stripe/webhook.ts"),
      "utf8",
    );
    const helper = source.slice(
      source.indexOf("async function maybeAutoPayout"),
      source.indexOf("async function resolveInvoiceIdFromCharge"),
    );

    expect(helper).toContain("AffiliatePayoutLedger.findOneAndUpdate");
    expect(helper).toContain("{ idempotencyKey }");
    expect(helper).toContain("$setOnInsert");
    expect(helper).toContain("{ upsert: true, new: false }");
    expect(helper).not.toContain("AffiliatePayoutLedger.findOne({ idempotencyKey })");
    expect(helper).not.toContain("AffiliatePayoutLedger.create({");
  });

  test("payout-all rejects authenticated non-admin before enqueueing", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { email: "user@example.com" } });
    const { req, res } = mockReqRes();

    await payoutAll(req, res);

    expect(res.statusCode).toBe(403);
    expect(mockedStripe.transfers.create).not.toHaveBeenCalled();
  });

  test("watchdog sends ambiguous stale charging BillingEvents to manual review", async () => {
    const staleBillingEvent = {
      _id: "be1",
      idempotencyKey: "billing_ai_voice_call_CA123_8",
      stripeInvoiceId: "",
    };
    const staleUsageLedger = {
      _id: "aul1",
      idempotencyKey: "ai_call_usage:CA123",
      stripeInvoiceId: "",
    };

    mockedUser.aggregate.mockReturnValue(execChain([]));
    mockedUser.find.mockReturnValue(leanChain([]));
    mockedUsageAccrualLedger.aggregate.mockReturnValue(execChain([]));
    mockedBillingEvent.find.mockReturnValue(leanChain([staleBillingEvent]));
    mockedAiCallUsageLedger.find.mockReturnValue(leanChain([staleUsageLedger]));
    mockedBillingEvent.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockedAiCallUsageLedger.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockedSession.find.mockReturnValue(leanChain([]));
    mockedSession.updateOne.mockResolvedValue({ modifiedCount: 0 });

    const { req, res } = mockReqRes({
      method: "POST",
      headers: { "x-cron-key": "cron-secret" },
    });

    await watchdog(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.recoveredBillingEvents).toBe(1);
    expect(res.body.recoveredAiCallUsageLedgers).toBe(1);
    expect(mockedBillingEvent.updateOne).toHaveBeenCalledWith(
      { _id: "be1", status: "charging" },
      expect.objectContaining({
        $set: expect.objectContaining({
          needsManualReview: true,
          manualReviewReason: "ambiguous_invoice_creation",
        }),
      }),
    );
    expect(mockedAiCallUsageLedger.updateOne).toHaveBeenCalledWith(
      { _id: "aul1", status: "charging" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "pending" }),
      }),
    );
  });

  test("watchdog drift canary logs bucket drift and sets charge hold", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedUser.aggregate.mockReturnValue(execChain([]));
    mockedBillingEvent.find.mockReturnValue(leanChain([]));
    mockedAiCallUsageLedger.find.mockReturnValue(leanChain([]));
    mockedSession.find.mockReturnValue(leanChain([]));
    mockedSession.updateOne.mockResolvedValue({ modifiedCount: 0 });
    mockedUsageAccrualLedger.aggregate.mockReturnValue(
      execChain([{ _id: { userEmail: "user@example.com", bucket: "regular" }, expected: 250 }]),
    );
    mockedUser.find.mockReturnValue(
      leanChain([{ email: "user@example.com", usageAccruedCents: 100, aiDialerAccruedSessionCents: 0 }]),
    );
    mockedUser.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { req, res } = mockReqRes({
      method: "POST",
      headers: { "x-cron-key": "cron-secret" },
    });

    await watchdog(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.bucketDrifts).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[BILLING][BUCKET-DRIFT]",
      expect.objectContaining({
        user: "user@example.com",
        bucket: "regular",
        expected: 250,
        stored: 100,
      }),
    );
    expect(mockedUser.updateOne).toHaveBeenCalledWith(
      { email: "user@example.com" },
      expect.objectContaining({
        $set: expect.objectContaining({
          usageBillingHold: true,
          usageBillingHoldReason: "bucket_drift",
        }),
      }),
    );
    errorSpy.mockRestore();
  });
});
