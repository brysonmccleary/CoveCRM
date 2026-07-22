describe("standalone threshold invoice safety", () => {
  const event = {
    _id: "event_1",
    status: "pending",
    source: "regular_usage",
    sourceId: "regular_usage:user_1:1",
    amountCents: 1000,
  };

  function setup({ draftAmount = 1000, paidAmount = 1000, payRejects = false, status = "pending", nestedInvoiceItem = false } = {}) {
    jest.resetModules();
    const BillingEvent = {
      findOneAndUpdate: jest.fn()
        .mockResolvedValueOnce({ ...event, status })
        .mockResolvedValueOnce({ ...event, status: "charging" }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      findById: jest.fn().mockResolvedValue({ ...event, status: "paid" }),
    };
    const invoice = (invoiceStatus: string, amountDue: number, amountPaid = 0) => ({
      id: "in_1", customer: "cus_1", currency: "usd", status: invoiceStatus,
      amount_due: amountDue, amount_paid: amountPaid,
      metadata: { billingEventId: "event_1", bucket: "regular", amountCents: "1000" },
    });
    const stripe = {
      invoices: {
        create: jest.fn().mockResolvedValue(invoice("draft", draftAmount)),
        retrieve: jest.fn()
          .mockResolvedValueOnce(invoice("draft", draftAmount))
          .mockResolvedValueOnce(invoice("paid", paidAmount, paidAmount)),
        listLineItems: jest.fn().mockResolvedValue({ data: [{
          ...(nestedInvoiceItem
            ? { parent: { invoice_item_details: { invoice_item: "ii_1" } } }
            : { invoice_item: "ii_1" }),
          amount: 1000,
          metadata: { billingEventId: "event_1", bucket: "regular", amountCents: "1000" },
        }] }),
        finalizeInvoice: jest.fn().mockResolvedValue(invoice("open", draftAmount)),
        pay: payRejects ? jest.fn().mockRejectedValue(new Error("card declined")) : jest.fn().mockResolvedValue(invoice("paid", paidAmount, paidAmount)),
      },
      invoiceItems: { create: jest.fn().mockResolvedValue({ id: "ii_1" }) },
    };
    jest.doMock("@/models/BillingEvent", () => ({ __esModule: true, default: BillingEvent }));
    jest.doMock("@/lib/stripe", () => ({ stripe }));
    jest.doMock("@/lib/billing/assertStripeWritesEnabled", () => ({ assertStripeWritesEnabled: jest.fn() }));
    return { BillingEvent, stripe };
  }

  const params = {
    customerId: "cus_1", amountCents: 1000, description: "Usage", source: "regular_usage" as const,
    sourceId: "regular_usage:user_1:1", userEmail: "user@example.com", userId: "user_1", bucket: "regular" as const,
  };

  test("creates one empty standalone invoice and attaches one exact item", async () => {
    const { stripe } = setup();
    const { settleStandaloneThresholdInvoice } = await import("@/lib/billing/standaloneInvoice");
    await settleStandaloneThresholdInvoice(params);
    expect(stripe.invoices.create).toHaveBeenCalledWith(expect.objectContaining({
      customer: "cus_1", auto_advance: false, collection_method: "charge_automatically", pending_invoice_items_behavior: "exclude",
    }), expect.any(Object));
    expect(stripe.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({
      invoice: "in_1", customer: "cus_1", amount: 1000, currency: "usd", discountable: false,
    }), expect.any(Object));
    expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledTimes(1);
    expect(stripe.invoices.pay).toHaveBeenCalledTimes(1);
  });

  test("accepts Stripe's current nested invoice-item line reference", async () => {
    const { stripe } = setup({ nestedInvoiceItem: true });
    const { settleStandaloneThresholdInvoice } = await import("@/lib/billing/standaloneInvoice");
    await settleStandaloneThresholdInvoice(params);
    expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledTimes(1);
    expect(stripe.invoices.pay).toHaveBeenCalledTimes(1);
  });

  test("rejects a wrong draft amount before finalization", async () => {
    const { stripe } = setup({ draftAmount: 999 });
    const { settleStandaloneThresholdInvoice } = await import("@/lib/billing/standaloneInvoice");
    await expect(settleStandaloneThresholdInvoice(params)).rejects.toThrow("Standalone invoice validation failed");
    expect(stripe.invoices.finalizeInvoice).not.toHaveBeenCalled();
  });

  test("rejects a wrong paid amount before marking the event paid", async () => {
    const { BillingEvent } = setup({ paidAmount: 999 });
    const { settleStandaloneThresholdInvoice } = await import("@/lib/billing/standaloneInvoice");
    await expect(settleStandaloneThresholdInvoice(params)).rejects.toThrow("Standalone invoice validation failed");
    expect(BillingEvent.updateOne.mock.calls.some(([, update]: any[]) => update?.$set?.status === "paid")).toBe(false);
  });

  test("a declined payment never marks the event paid", async () => {
    const { BillingEvent } = setup({ payRejects: true });
    const { settleStandaloneThresholdInvoice } = await import("@/lib/billing/standaloneInvoice");
    await expect(settleStandaloneThresholdInvoice(params)).rejects.toThrow("card declined");
    expect(BillingEvent.updateOne.mock.calls.some(([, update]: any[]) => update?.$set?.status === "paid")).toBe(false);
  });

  test("an applied event is a Stripe no-op", async () => {
    const { stripe } = setup({ status: "applied" });
    const { settleStandaloneThresholdInvoice } = await import("@/lib/billing/standaloneInvoice");
    await settleStandaloneThresholdInvoice(params);
    expect(stripe.invoices.create).not.toHaveBeenCalled();
    expect(stripe.invoiceItems.create).not.toHaveBeenCalled();
  });

  test("an ambiguous charging event without a persisted invoice fails closed", async () => {
    const { stripe } = setup({ status: "charging" });
    const { settleStandaloneThresholdInvoice } = await import("@/lib/billing/standaloneInvoice");
    await expect(settleStandaloneThresholdInvoice(params)).rejects.toThrow("manual review required");
    expect(stripe.invoices.create).not.toHaveBeenCalled();
  });

  test("a manual-review BillingEvent refuses all automatic Stripe work", async () => {
    const { BillingEvent, stripe } = setup({ status: "charging" });
    BillingEvent.findOneAndUpdate.mockReset().mockResolvedValueOnce({ ...event, status: "charging", needsManualReview: true });
    const { settleStandaloneThresholdInvoice } = await import("@/lib/billing/standaloneInvoice");
    await expect(settleStandaloneThresholdInvoice(params)).rejects.toThrow("requires manual review");
    expect(stripe.invoices.create).not.toHaveBeenCalled();
    expect(stripe.invoiceItems.create).not.toHaveBeenCalled();
    expect(stripe.invoices.pay).not.toHaveBeenCalled();
  });

  test("a watchdog-style AI checkpoint accrues over $20 without creating an invoice", async () => {
    jest.resetModules();
    const chain = (value: any) => ({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) });
    const createFinalizePayInvoice = jest.fn();
    const applyPaidBillingEvent = jest.fn();
    jest.doMock("mongoose", () => ({
      __esModule: true,
      default: { connection: { readyState: 1 }, connect: jest.fn(), Types: { ObjectId: jest.fn(() => ({ toString: () => "lock" })) } },
      connection: { readyState: 1 }, connect: jest.fn(), Types: { ObjectId: jest.fn(() => ({ toString: () => "lock" })) },
    }));
    jest.doMock("@/models/User", () => ({ __esModule: true, default: {
      findOne: jest.fn().mockReturnValue(chain({ _id: "user_1", hasAI: true, hasEverPaid: true, stripeCustomerId: "cus_1" })),
      findOneAndUpdate: jest.fn().mockResolvedValue({ aiDialerAccruedSessionCents: 2500 }),
      updateOne: jest.fn(),
    } }));
    jest.doMock("@/models/AICallSession", () => ({ __esModule: true, default: {} }));
    jest.doMock("@/lib/billing/trackUsage", () => ({ createFinalizePayInvoice, applyPaidBillingEvent }));
    jest.doMock("@/lib/billing/usageAccrualLedger", () => ({
      recordUsageAccrualOnce: jest.fn().mockResolvedValue({ accrued: true }),
      getPendingAccrualLedgerCents: jest.fn(),
    }));
    const { trackAiDialerCentsUsage } = await import("@/lib/billing/trackAiDialerSessionUsage");
    const result = await trackAiDialerCentsUsage({
      userEmail: "user@example.com", addCents: 2500, description: "checkpoint", source: "ai_voice_session", eventKey: "watchdog-1", allowThresholdCharge: false,
    });
    expect(result).toEqual(expect.objectContaining({ accrued: 2500, charged: false }));
    expect(createFinalizePayInvoice).not.toHaveBeenCalled();
    expect(applyPaidBillingEvent).not.toHaveBeenCalled();
  });

  test("threshold source identifiers are immutable and one-trigger only", () => {
    const regular = require("fs").readFileSync(require("path").join(__dirname, "../lib/billing/trackUsage.ts"), "utf8");
    const ai = require("fs").readFileSync(require("path").join(__dirname, "../lib/billing/trackAiDialerSessionUsage.ts"), "utf8");
    expect(regular).toContain("regular_usage:${String(userDoc._id)}:${thresholdSequence}");
    expect(ai).toContain("ai_voice_session:${String((userDoc as any)._id)}:${thresholdSequence}");
    expect(regular).toContain("ledgerPendingCents >= TOPUP_AMOUNT_CENTS ? TOPUP_AMOUNT_CENTS : 0");
    expect(ai).toContain("ledgerPendingCents >= SESSION_THRESHOLD_CENTS ? SESSION_THRESHOLD_CENTS : 0");
  });
});
