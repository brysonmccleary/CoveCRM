import { processAffiliatePayoutsNow } from "../pages/api/cron/process-affiliate-payouts";
import Affiliate from "@/models/Affiliate";
import AffiliatePayoutLedger from "@/models/AffiliatePayoutLedger";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/lib/billing/assertStripeWritesEnabled", () => ({
  assertStripeWritesEnabled: jest.fn(),
}));

jest.mock("@/lib/stripe", () => ({
  stripe: { transfers: { create: jest.fn() } },
}));

jest.mock("@/models/Affiliate", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("@/models/AffiliatePayoutLedger", () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

jest.mock("@/models/User", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

function lean(value: unknown) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) };
}

const mockedAffiliate = Affiliate as unknown as { findById: jest.Mock };
const mockedLedger = AffiliatePayoutLedger as unknown as {
  aggregate: jest.Mock;
  find: jest.Mock;
  findOneAndUpdate: jest.Mock;
  countDocuments: jest.Mock;
};
const mockedUser = User as unknown as { findById: jest.Mock };
const mockedStripe = stripe as unknown as { transfers: { create: jest.Mock } };

function readyAffiliate() {
  return {
    _id: "aff1",
    userId: "owner1",
    stripeConnectId: "acct_1",
    onboardingCompleted: true,
    approved: true,
  };
}

describe("affiliate payout retry path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAffiliate.findById.mockResolvedValue(readyAffiliate());
    mockedUser.findById.mockReturnValue(lean({ subscriptionStatus: "active", billingBlocked: false }));
    mockedLedger.aggregate.mockResolvedValue([{ _id: "aff1", totalCents: 1250, count: 1 }]);
    mockedLedger.countDocuments.mockResolvedValue(0);
  });

  test("a transient failure is requeued to held with backoff, not left permanently stuck", async () => {
    const credit: any = {
      _id: "ledger1",
      affiliateId: "aff1",
      userId: "user1",
      status: "held",
      retryCount: 0,
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockedLedger.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([credit]) }),
    });
    mockedLedger.findOneAndUpdate.mockImplementation(async () => {
      if (credit.status !== "held") return null;
      credit.status = "processing";
      return credit;
    });
    mockedStripe.transfers.create.mockRejectedValue(new Error("Stripe rate limited"));

    const before = Date.now();
    const result = await processAffiliatePayoutsNow();

    expect(credit.status).toBe("held"); // requeued, not stuck
    expect(credit.retryCount).toBe(1);
    expect(credit.payableAt.getTime()).toBeGreaterThan(before); // backoff pushed forward
    expect(result.failedRetryable).toBe(1);
    expect(result.failedPermanent).toBe(0);
    expect(result.failed).toBe(1); // back-compat aggregate field
  });

  test("retries exhaust after MAX_PAYOUT_RETRY_ATTEMPTS and the credit becomes genuinely terminal", async () => {
    const credit: any = {
      _id: "ledger1",
      affiliateId: "aff1",
      userId: "user1",
      status: "held",
      retryCount: 4, // one more failure will be the 5th attempt
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockedLedger.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([credit]) }),
    });
    mockedLedger.findOneAndUpdate.mockImplementation(async () => {
      if (credit.status !== "held") return null;
      credit.status = "processing";
      return credit;
    });
    mockedStripe.transfers.create.mockRejectedValue(new Error("still failing"));

    const result = await processAffiliatePayoutsNow();

    expect(credit.status).toBe("failed_permanent");
    expect(credit.retryCount).toBe(5);
    expect(result.failedPermanent).toBe(1);
    expect(result.failedRetryable).toBe(0);
  });

  test("stuckPayoutsTotal surfaces the existing backlog even on a run with no new failures", async () => {
    mockedLedger.aggregate.mockResolvedValue([]); // nothing payable this run
    mockedLedger.countDocuments.mockResolvedValue(3); // 3 rows already stuck from before

    const result = await processAffiliatePayoutsNow();

    expect(result.stuckPayoutsTotal).toBe(3);
    expect(mockedLedger.countDocuments).toHaveBeenCalledWith({
      status: { $in: ["failed_permanent", "failed"] },
    });
  });

  test("a requeued (held, future payableAt) credit is not immediately reclaimed by the same run", async () => {
    // Simulates: claim query only matches payableAt <= now, so after backoff
    // is applied it correctly won't be picked up again until a future run.
    const credit: any = {
      _id: "ledger1",
      affiliateId: "aff1",
      userId: "user1",
      status: "held",
      retryCount: 0,
      save: jest.fn().mockResolvedValue(undefined),
    };
    let claimAttempts = 0;
    mockedLedger.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([credit]) }),
    });
    mockedLedger.findOneAndUpdate.mockImplementation(async () => {
      claimAttempts += 1;
      if (credit.status !== "held") return null;
      credit.status = "processing";
      return credit;
    });
    mockedStripe.transfers.create.mockRejectedValue(new Error("transient"));

    await processAffiliatePayoutsNow();

    // Only one claim attempt happened within this single run — the backoff
    // window means it won't resurface in the SAME aggregate/find pass again.
    expect(claimAttempts).toBe(1);
    expect(credit.status).toBe("held");
  });
});
