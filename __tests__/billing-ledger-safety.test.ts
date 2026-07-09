describe("usage accrual ledger safety", () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock("@/lib/billing/usageAccrualLedger");
    jest.dontMock("@/models/UsageAccrualLedger");
    jest.dontMock("@/models/A2PProfile");
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function mockMongoose() {
    jest.doMock("mongoose", () => ({
      __esModule: true,
      default: {
        connection: { readyState: 1 },
        connect: jest.fn(),
        Types: { ObjectId: jest.fn(() => ({ toString: () => "lock-owner" })) },
        isValidObjectId: jest.fn(() => true),
      },
      connection: { readyState: 1 },
      connect: jest.fn(),
      Types: { ObjectId: jest.fn(() => ({ toString: () => "lock-owner" })) },
      isValidObjectId: jest.fn(() => true),
    }));
  }

  function chain(value: unknown) {
    return {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(value),
    };
  }

  function setupTrackUsageTest({
    ledgerPendingCents,
    consumedCents,
    payRejects = false,
  }: {
    ledgerPendingCents: number;
    consumedCents: number;
    payRejects?: boolean;
  }) {
    mockMongoose();
    const userDoc = {
      _id: "user-id",
      email: "user@example.com",
      stripeCustomerId: "cus_123",
      hasEverPaid: true,
      billingBlocked: false,
    };
    const User = {
      findById: jest.fn(),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(userDoc)
        .mockReturnValueOnce(chain({ stripeCustomerId: "cus_123" }))
        .mockReturnValueOnce(chain({ hasEverPaid: true, billingBlocked: false, stripeCustomerId: "cus_123" })),
      findOneAndUpdate: jest
        .fn()
        .mockResolvedValueOnce({ usageAccruedCents: 1000, usageBillingHold: false })
        .mockResolvedValueOnce({ usageAccruedCents: 1000, usageBilledTotalCents: 0 })
        .mockResolvedValueOnce({ usageAccruedCents: 0, usageBilledTotalCents: 1000 }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const BillingEvent = {
      findOne: jest.fn(),
      findOneAndUpdate: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: "event-id", status: "charging" }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const stripe = {
      invoiceItems: {
        create: jest.fn().mockResolvedValue({ id: "ii_123" }),
        del: jest.fn().mockResolvedValue({}),
      },
      invoices: {
        create: jest.fn().mockResolvedValue({ id: "in_123" }),
        finalizeInvoice: jest.fn().mockResolvedValue({}),
        pay: payRejects
          ? jest.fn().mockRejectedValue(new Error("card failed"))
          : jest.fn().mockResolvedValue({}),
      },
    };
    const usageLedger = {
      recordUsageAccrualOnce: jest.fn().mockResolvedValue({ accrued: true, duplicate: false, amountCents: 1000 }),
      getPendingAccrualLedgerCents: jest.fn().mockResolvedValue(ledgerPendingCents),
      consumeAccrualLedgerCents: jest.fn().mockResolvedValue(consumedCents),
    };
    jest.doMock("@/models/User", () => ({ __esModule: true, default: User }));
    jest.doMock("@/models/A2PProfile", () => ({ __esModule: true, default: {} }));
    jest.doMock("@/models/BillingEvent", () => ({ __esModule: true, default: BillingEvent }));
    jest.doMock("@/lib/stripe", () => ({ stripe }));
    jest.doMock("@/lib/billing/assertStripeWritesEnabled", () => ({
      assertStripeWritesEnabled: jest.fn(),
    }));
    jest.doMock("@/lib/billing/usageAccrualLedger", () => usageLedger);
    return { User, BillingEvent, stripe, usageLedger, userDoc };
  }

  function setupAiVoiceTest({
    consumedCents,
  }: {
    consumedCents: number;
  }) {
    mockMongoose();
    const User = {
      findOne: jest
        .fn()
        .mockReturnValueOnce(
          chain({
            _id: "user-id",
            email: "user@example.com",
            hasAI: true,
            hasEverPaid: true,
            billingBlocked: false,
            stripeCustomerId: "cus_123",
          }),
        )
        .mockReturnValueOnce(chain({ stripeCustomerId: "cus_123" }))
        .mockReturnValueOnce(chain({ hasEverPaid: true, billingBlocked: false, stripeCustomerId: "cus_123" })),
      findOneAndUpdate: jest
        .fn()
        .mockResolvedValueOnce({ aiDialerAccruedSessionCents: 2000, aiDialerBillingHold: false })
        .mockResolvedValueOnce({ aiDialerAccruedSessionCents: 2000, aiDialerBilledTotalCents: 0 })
        .mockResolvedValueOnce({ aiDialerAccruedSessionCents: 0, aiDialerBilledTotalCents: 2000 }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const BillingEvent = {
      findOneAndUpdate: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: "event-id", status: "charging" }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const stripe = {
      invoiceItems: { create: jest.fn().mockResolvedValue({ id: "ii_123" }), del: jest.fn() },
      invoices: {
        create: jest.fn().mockResolvedValue({ id: "in_123" }),
        finalizeInvoice: jest.fn().mockResolvedValue({}),
        pay: jest.fn().mockResolvedValue({}),
      },
    };
    const usageLedger = {
      recordUsageAccrualOnce: jest.fn().mockResolvedValue({ accrued: true, duplicate: false, amountCents: 2000 }),
      getPendingAccrualLedgerCents: jest.fn().mockResolvedValue(2500),
      consumeAccrualLedgerCents: jest.fn().mockResolvedValue(consumedCents),
    };
    jest.doMock("@/models/User", () => ({ __esModule: true, default: User }));
    jest.doMock("@/models/AICallSession", () => ({ __esModule: true, default: {} }));
    jest.doMock("@/models/A2PProfile", () => ({ __esModule: true, default: {} }));
    jest.doMock("@/models/BillingEvent", () => ({ __esModule: true, default: BillingEvent }));
    jest.doMock("@/lib/stripe", () => ({ stripe }));
    jest.doMock("@/lib/billing/assertStripeWritesEnabled", () => ({
      assertStripeWritesEnabled: jest.fn(),
    }));
    jest.doMock("@/lib/billing/usageAccrualLedger", () => usageLedger);
    return { User, stripe, usageLedger };
  }

  test("duplicate regular event key does not double accrue", async () => {
    jest.doMock("@/models/UsageAccrualLedger", () => ({
      __esModule: true,
      default: {
        findOneAndUpdate: jest.fn().mockReturnValue(chain({ eventKey: "regular:sms-out:SM1", amountCents: 2 })),
      },
    }));
    const { recordUsageAccrualOnce } = await import("@/lib/billing/usageAccrualLedger");
    const result = await recordUsageAccrualOnce({
      bucket: "regular",
      userEmail: "user@example.com",
      eventKey: "regular:sms-out:SM1",
      source: "twilio",
      amountCents: 2,
    });
    expect(result).toEqual({ accrued: false, duplicate: true, amountCents: 2 });
  });

  test("failed Stripe charge does not consume regular ledger rows", async () => {
    const { stripe, usageLedger } = setupTrackUsageTest({
      ledgerPendingCents: 1000,
      consumedCents: 0,
      payRejects: true,
    });
    const { trackUsage } = await import("@/lib/billing/trackUsage");
    await trackUsage({ user: { email: "user@example.com" }, amount: 10, source: "twilio", eventKey: "evt-1" });
    expect(stripe.invoices.pay).toHaveBeenCalledTimes(1);
    expect(usageLedger.consumeAccrualLedgerCents).not.toHaveBeenCalled();
  });

  test("successful regular threshold charge consumes exactly included ledger rows", async () => {
    const { usageLedger } = setupTrackUsageTest({ ledgerPendingCents: 1500, consumedCents: 1000 });
    const { trackUsage } = await import("@/lib/billing/trackUsage");
    await trackUsage({ user: { email: "user@example.com" }, amount: 10, source: "twilio", eventKey: "evt-2" });
    expect(usageLedger.consumeAccrualLedgerCents).toHaveBeenCalledWith({
      bucket: "regular",
      userEmail: "user@example.com",
      amountCents: 1000,
    });
  });

  test("invoice cannot exceed pending ledger-backed cents", async () => {
    const { stripe, usageLedger } = setupTrackUsageTest({ ledgerPendingCents: 999, consumedCents: 0 });
    const { trackUsage } = await import("@/lib/billing/trackUsage");
    await trackUsage({ user: { email: "user@example.com" }, amount: 10, source: "twilio", eventKey: "evt-3" });
    expect(stripe.invoiceItems.create).not.toHaveBeenCalled();
    expect(usageLedger.consumeAccrualLedgerCents).not.toHaveBeenCalled();
  });

  test("successful AI voice threshold charge consumes exactly included ledger rows", async () => {
    const { usageLedger } = setupAiVoiceTest({ consumedCents: 2000 });
    const { trackAiDialerCentsUsage } = await import("@/lib/billing/trackAiDialerSessionUsage");
    await trackAiDialerCentsUsage({
      userEmail: "user@example.com",
      addCents: 2000,
      description: "AI voice usage",
      source: "ai_voice_call",
      eventKey: "call:CA1",
    });
    expect(usageLedger.consumeAccrualLedgerCents).toHaveBeenCalledWith({
      bucket: "ai_voice",
      userEmail: "user@example.com",
      amountCents: 2000,
    });
  });

  test("partial threshold invoice consumes only included rows", async () => {
    const rows = [
      { _id: "a", amountCents: 700, billedCents: 0 },
      { _id: "b", amountCents: 700, billedCents: 0 },
    ];
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    jest.doMock("@/models/UsageAccrualLedger", () => ({
      __esModule: true,
      default: {
        find: jest.fn(() => ({
          sort: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue(rows),
        })),
        updateOne,
      },
    }));
    const { consumeAccrualLedgerCents } = await import("@/lib/billing/usageAccrualLedger");
    const consumed = await consumeAccrualLedgerCents({
      bucket: "regular",
      userEmail: "user@example.com",
      amountCents: 1000,
    });
    expect(consumed).toBe(1000);
    expect(updateOne).toHaveBeenNthCalledWith(1, { _id: "a", billedCents: 0 }, expect.any(Object));
    expect(updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: "b", billedCents: 0 },
      expect.objectContaining({ $set: expect.objectContaining({ billedCents: 300 }) }),
    );
  });

  test("ledger consumption shortfall places a regular bucket hold", async () => {
    const { User } = setupTrackUsageTest({ ledgerPendingCents: 1000, consumedCents: 700 });
    const { trackUsage } = await import("@/lib/billing/trackUsage");
    await trackUsage({ user: { email: "user@example.com" }, amount: 10, source: "twilio", eventKey: "evt-4" });
    expect(User.updateOne).toHaveBeenCalledWith(
      { email: "user@example.com" },
      expect.objectContaining({
        $set: expect.objectContaining({
          usageBillingHold: true,
          usageBillingHoldReason: "ledger_consumption_shortfall",
        }),
      }),
    );
  });

  test("inbound duplicate MessageSid returns before second accrual", () => {
    const source = require("fs").readFileSync(
      require("path").join(__dirname, "../pages/api/twilio/inbound-sms.ts"),
      "utf8",
    );
    expect(source.indexOf("Message.findOne({ sid: messageSid })")).toBeLessThan(
      source.indexOf("eventKey: `sms-in:${messageSid || String(savedMessage._id)}`"),
    );
  });
});
