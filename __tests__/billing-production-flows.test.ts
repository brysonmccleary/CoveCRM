type Bucket = "regular" | "ai_voice";

function query<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
    session: jest.fn().mockResolvedValue(value),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
}

function applyUpdate(target: Record<string, any>, update: any) {
  for (const [key, value] of Object.entries(update?.$inc || {})) target[key] = Number(target[key] || 0) + Number(value);
  for (const [key, value] of Object.entries(update?.$set || {})) target[key] = value;
  for (const key of Object.keys(update?.$unset || {})) delete target[key];
}

function setupHarness(options?: { regularCents?: number; aiCents?: number; failPay?: boolean; failTransaction?: boolean; approved?: boolean }) {
  jest.resetModules();
  const user: Record<string, any> = {
    _id: "user_1", email: "user@example.com", stripeCustomerId: "cus_1", hasEverPaid: true,
    billingBlocked: false, hasAI: true, usageAccruedCents: options?.regularCents || 0,
    usageBilledTotalCents: 0, aiDialerAccruedSessionCents: options?.aiCents || 0,
    aiDialerBilledTotalCents: 0, a2p: options?.approved === false ? {} : { campaignSid: "campaign_1", messagingReady: true },
    save: jest.fn(),
  };
  const ledger = { regular: options?.regularCents || 0, ai_voice: options?.aiCents || 0 };
  const eventKeys = new Set<string>();
  const events = new Map<string, any>();
  const invoices = new Map<string, any>();
  const invoiceItems = new Map<string, any>();
  let invoiceSeq = 0;
  let itemSeq = 0;
  let failPay = Boolean(options?.failPay);
  let failTransaction = Boolean(options?.failTransaction);

  const User = {
    findById: jest.fn().mockImplementation(() => Promise.resolve(user)),
    findOne: jest.fn().mockImplementation(() => query(user)),
    findOneAndUpdate: jest.fn().mockImplementation(async (filter: any, update: any) => {
      const amountGuard = filter?.usageAccruedCents?.$gte ?? filter?.aiDialerAccruedSessionCents?.$gte;
      const current = filter?.usageAccruedCents ? user.usageAccruedCents : filter?.aiDialerAccruedSessionCents ? user.aiDialerAccruedSessionCents : undefined;
      if (amountGuard !== undefined && Number(current || 0) < amountGuard) return null;
      applyUpdate(user, update);
      return { ...user };
    }),
    updateOne: jest.fn().mockImplementation(async (_filter: any, update: any) => {
      applyUpdate(user, update);
      return { modifiedCount: 1 };
    }),
  };

  const eventKey = (source: string, sourceId: string, amount: number) => `${source}|${sourceId}|${amount}`;
  const BillingEvent = {
    findOneAndUpdate: jest.fn().mockImplementation(async (filter: any, update: any) => {
      let event: any;
      if (filter._id) event = [...events.values()].find((row) => row._id === String(filter._id));
      else event = events.get(eventKey(filter.source, filter.sourceId, filter.amountCents));
      if (event && filter.status) {
        const allowed = filter.status.$in || [filter.status];
        if (!allowed.includes(event.status)) return null;
      }
      if (!event && update.$setOnInsert) {
        event = { _id: `event_${events.size + 1}`, source: filter.source, sourceId: filter.sourceId, amountCents: filter.amountCents, ...update.$setOnInsert };
        events.set(eventKey(filter.source, filter.sourceId, filter.amountCents), event);
      }
      if (!event) return null;
      applyUpdate(event, update);
      return { ...event };
    }),
    findOne: jest.fn().mockImplementation((filter: any) => {
      const event = filter._id
        ? [...events.values()].find((row) => row._id === String(filter._id) && (!filter.status || row.status === filter.status))
        : events.get(eventKey(filter.source, filter.sourceId, filter.amountCents));
      return query(event || null);
    }),
    findById: jest.fn().mockImplementation(async (id: string) => {
      const event = [...events.values()].find((row) => row._id === String(id));
      return event ? { ...event } : null;
    }),
    find: jest.fn().mockImplementation((filter: any) => query([...events.values()].filter((row) => row.status === filter.status && !row.appliedAt))),
    updateOne: jest.fn().mockImplementation(async (filter: any, update: any) => {
      const event = [...events.values()].find((row) => row._id === String(filter._id));
      if (!event || (filter.status && event.status !== filter.status)) return { modifiedCount: 0 };
      applyUpdate(event, update);
      return { modifiedCount: 1 };
    }),
  };

  const stripe = {
    customers: {
      retrieve: jest.fn().mockResolvedValue({ id: "cus_1", metadata: {} }),
      update: jest.fn().mockResolvedValue({ id: "cus_1" }),
    },
    invoices: {
      create: jest.fn().mockImplementation(async (params: any) => {
        const invoice = { id: `in_${++invoiceSeq}`, customer: params.customer, currency: "usd", status: "draft", amount_due: 0, amount_paid: 0, metadata: params.metadata, createParams: params };
        invoices.set(invoice.id, invoice);
        return { ...invoice };
      }),
      retrieve: jest.fn().mockImplementation(async (id: string) => ({ ...invoices.get(id) })),
      listLineItems: jest.fn().mockImplementation(async (id: string) => ({ data: [...invoiceItems.values()].filter((item) => item.invoice === id).map((item) => ({ invoice_item: item.id, amount: item.amount, metadata: item.metadata })) })),
      finalizeInvoice: jest.fn().mockImplementation(async (id: string) => { const invoice = invoices.get(id); invoice.status = "open"; return { ...invoice }; }),
      pay: jest.fn().mockImplementation(async (id: string) => {
        if (failPay) throw new Error("card declined");
        const invoice = invoices.get(id); invoice.status = "paid"; invoice.amount_paid = invoice.amount_due; return { ...invoice };
      }),
    },
    invoiceItems: {
      create: jest.fn().mockImplementation(async (params: any) => {
        const item = { id: `ii_${++itemSeq}`, ...params };
        invoiceItems.set(item.id, item);
        const invoice = invoices.get(params.invoice); invoice.amount_due += params.amount;
        return { ...item };
      }),
    },
  };

  const usageLedger = {
    recordUsageAccrualOnce: jest.fn().mockImplementation(async (args: any) => {
      const key = `${args.userEmail}|${args.bucket}|${args.eventKey}`;
      if (eventKeys.has(key)) return { accrued: false, duplicate: true, amountCents: args.amountCents };
      eventKeys.add(key); ledger[args.bucket as Bucket] += args.amountCents;
      return { accrued: true, duplicate: false, amountCents: args.amountCents };
    }),
    getPendingAccrualLedgerCents: jest.fn().mockImplementation(async (args: any) => ledger[args.bucket as Bucket]),
    consumeAccrualLedgerCents: jest.fn().mockImplementation(async (args: any) => {
      const amount = Math.min(ledger[args.bucket as Bucket], args.amountCents);
      ledger[args.bucket as Bucket] -= amount;
      return amount;
    }),
  };

  jest.doMock("mongoose", () => ({
    __esModule: true,
    default: {
      connection: { readyState: 1 }, connect: jest.fn(), isValidObjectId: jest.fn(() => true),
      Types: { ObjectId: jest.fn(() => ({ toString: () => "lock_1" })) },
      startSession: jest.fn(async () => ({
        withTransaction: async (callback: any) => { if (failTransaction) throw new Error("transactions unsupported"); return callback(); },
        endSession: jest.fn(),
      })),
    },
  }));
  jest.doMock("@/models/User", () => ({ __esModule: true, default: User }));
  jest.doMock("@/models/BillingEvent", () => ({ __esModule: true, default: BillingEvent }));
  jest.doMock("@/models/A2PProfile", () => ({ __esModule: true, default: { findOne: jest.fn().mockResolvedValue(null) } }));
  jest.doMock("@/models/AICallSession", () => ({ __esModule: true, default: {} }));
  jest.doMock("@/lib/stripe", () => ({ stripe }));
  jest.doMock("@/lib/billing/assertStripeWritesEnabled", () => ({ assertStripeWritesEnabled: jest.fn() }));
  jest.doMock("@/lib/billing/usageAccrualLedger", () => usageLedger);

  return {
    user, ledger, events, invoices, invoiceItems, stripe, usageLedger,
    setFailPay: (value: boolean) => { failPay = value; },
    setFailTransaction: (value: boolean) => { failTransaction = value; },
  };
}

describe("production threshold billing entry points", () => {
  async function loadChargingRecovery() {
    jest.doMock("@/lib/mongooseConnect", () => ({ __esModule: true, default: jest.fn() }));
    jest.doMock("@/models/AICallUsageLedger", () => ({ __esModule: true, default: {} }));
    jest.doMock("@/models/UsageAccrualLedger", () => ({ __esModule: true, default: {} }));
    return (await import("../pages/api/ai-calls/watchdog")).recoverStaleChargingBillingEvents;
  }

  test("regular $9.99 + $0.01 charges once and duplicate request is a no-op", async () => {
    const h = setupHarness({ regularCents: 999 });
    const { trackUsage } = await import("@/lib/billing/trackUsage");
    await trackUsage({ user: h.user, amount: 0.01, source: "twilio", eventKey: "regular-1" });
    expect(h.stripe.invoices.create).toHaveBeenCalledTimes(1);
    expect(h.stripe.invoices.create.mock.calls[0][0]).toEqual(expect.objectContaining({ pending_invoice_items_behavior: "exclude" }));
    expect(h.stripe.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({ invoice: "in_1", amount: 1000 }), expect.any(Object));
    expect(h.stripe.invoices.finalizeInvoice).toHaveBeenCalledTimes(1);
    expect(h.stripe.invoices.pay).toHaveBeenCalledTimes(1);
    expect(h.user.usageAccruedCents).toBe(0);
    expect(h.user.usageBilledTotalCents).toBe(1000);
    expect(h.ledger.regular).toBe(0);
    expect([...h.events.values()][0].status).toBe("applied");
    await trackUsage({ user: h.user, amount: 0.01, source: "twilio", eventKey: "regular-1" });
    expect(h.stripe.invoices.create).toHaveBeenCalledTimes(1);
    expect(h.stripe.invoices.pay).toHaveBeenCalledTimes(1);
    expect(h.user.usageBilledTotalCents).toBe(1000);
  });

  test("regular $12.50 charges one $10 invoice and leaves $2.50", async () => {
    const h = setupHarness({ regularCents: 1249 });
    h.invoiceItems.set("ii_unrelated", { id: "ii_unrelated", invoice: null, customer: "cus_1", amount: 777, metadata: {} });
    const { trackUsage } = await import("@/lib/billing/trackUsage");
    await trackUsage({ user: h.user, amount: 0.01, source: "twilio", eventKey: "regular-rem" });
    expect(h.stripe.invoices.create).toHaveBeenCalledTimes(1);
    expect(h.stripe.invoiceItems.create.mock.calls[0][0].amount).toBe(1000);
    expect(h.user.usageAccruedCents).toBe(250);
    expect(h.ledger.regular).toBe(250);
    expect([...h.invoiceItems.values()].filter((item) => item.invoice === "in_1")).toHaveLength(1);
    expect(h.invoiceItems.get("ii_unrelated")?.invoice).toBeNull();
  });

  test("AI $19.99 + $0.01 charges once and AI $23.50 leaves $3.50", async () => {
    const h = setupHarness({ aiCents: 1999 });
    const { trackAiDialerCentsUsage } = await import("@/lib/billing/trackAiDialerSessionUsage");
    const args = { userEmail: h.user.email, addCents: 1, description: "AI usage", source: "ai_voice_call" as const, eventKey: "ai-1" };
    await trackAiDialerCentsUsage(args);
    expect(h.stripe.invoiceItems.create.mock.calls[0][0].amount).toBe(2000);
    expect(h.user.aiDialerAccruedSessionCents).toBe(0);
    expect(h.user.aiDialerBilledTotalCents).toBe(2000);
    expect(h.ledger.ai_voice).toBe(0);
    expect([...h.events.values()][0].status).toBe("applied");
    await trackAiDialerCentsUsage(args);
    expect(h.stripe.invoices.create).toHaveBeenCalledTimes(1);
    expect(h.stripe.invoices.pay).toHaveBeenCalledTimes(1);

    const remainder = setupHarness({ aiCents: 2349 });
    const ai = await import("@/lib/billing/trackAiDialerSessionUsage");
    await ai.trackAiDialerCentsUsage({ userEmail: remainder.user.email, addCents: 1, description: "AI remainder", source: "ai_voice_call", eventKey: "ai-rem" });
    expect(remainder.stripe.invoices.create).toHaveBeenCalledTimes(1);
    expect(remainder.user.aiDialerAccruedSessionCents).toBe(350);
    expect(remainder.ledger.ai_voice).toBe(350);
  });

  test("A2P approved charges $15 once; replay and unapproved state do not charge", async () => {
    const h = setupHarness({ approved: true });
    const { chargeA2PApprovalIfNeeded } = await import("@/lib/billing/trackUsage");
    expect(await chargeA2PApprovalIfNeeded({ user: h.user })).toEqual({ charged: true });
    expect(h.stripe.invoiceItems.create.mock.calls[0][0].amount).toBe(1500);
    expect([...h.events.values()][0].status).toBe("applied");
    await chargeA2PApprovalIfNeeded({ user: h.user });
    expect(h.stripe.invoices.create).toHaveBeenCalledTimes(1);
    expect(h.stripe.invoices.pay).toHaveBeenCalledTimes(1);

    const unapproved = setupHarness({ approved: false });
    const production = await import("@/lib/billing/trackUsage");
    expect(await production.chargeA2PApprovalIfNeeded({ user: unapproved.user })).toEqual({ charged: false, reason: "not-approved" });
    expect(unapproved.stripe.invoices.create).not.toHaveBeenCalled();
  });

  test("failed regular payment preserves bucket and retries the same invoice", async () => {
    const h = setupHarness({ regularCents: 999, failPay: true });
    const { trackUsage } = await import("@/lib/billing/trackUsage");
    await trackUsage({ user: h.user, amount: 0.01, source: "twilio", eventKey: "failure-1" });
    expect(h.user.usageAccruedCents).toBe(1000);
    expect(h.user.usageBilledTotalCents).toBe(0);
    expect(h.ledger.regular).toBe(1000);
    expect([...h.events.values()][0]).toEqual(expect.objectContaining({ status: "charging", stripeInvoiceId: "in_1" }));
    h.setFailPay(false);
    await trackUsage({ user: h.user, amount: 0, source: "twilio", eventKey: "retry-trigger" });
    expect(h.stripe.invoices.create).toHaveBeenCalledTimes(1);
  });

  test("failed AI payment preserves state and retries the stored invoice", async () => {
    const h = setupHarness({ aiCents: 1999, failPay: true });
    const { trackAiDialerCentsUsage } = await import("@/lib/billing/trackAiDialerSessionUsage");
    await trackAiDialerCentsUsage({ userEmail: h.user.email, addCents: 1, description: "AI failure", source: "ai_voice_call", eventKey: "ai-fail-1" });
    expect(h.user.aiDialerAccruedSessionCents).toBe(2000);
    expect(h.user.aiDialerBilledTotalCents).toBe(0);
    expect(h.ledger.ai_voice).toBe(2000);
    expect([...h.events.values()][0]).toEqual(expect.objectContaining({ status: "charging", stripeInvoiceId: "in_1" }));
    h.setFailPay(false);
    await trackAiDialerCentsUsage({ userEmail: h.user.email, addCents: 1, description: "AI retry", source: "ai_voice_call", eventKey: "ai-fail-2" });
    expect(h.stripe.invoices.create).toHaveBeenCalledTimes(1);
    expect(h.stripe.invoices.pay).toHaveBeenCalledTimes(2);
    expect(h.user.aiDialerBilledTotalCents).toBe(2000);
    expect(h.user.aiDialerAccruedSessionCents).toBe(1);
  });

  test("paid-but-unapplied transaction failure recovers once without another Stripe payment", async () => {
    const h = setupHarness({ regularCents: 999, failTransaction: true });
    const production = await import("@/lib/billing/trackUsage");
    await production.trackUsage({ user: h.user, amount: 0.01, source: "twilio", eventKey: "tx-fail" });
    const event = [...h.events.values()][0];
    expect(event).toEqual(expect.objectContaining({ status: "paid", needsApplicationReview: true }));
    expect(event.appliedAt).toBeUndefined();
    expect(h.user.usageAccruedCents).toBe(1000);
    expect(h.user.usageBilledTotalCents).toBe(0);
    expect(h.ledger.regular).toBe(1000);
    expect(h.stripe.invoices.pay).toHaveBeenCalledTimes(1);

    h.setFailTransaction(false);
    expect(await production.recoverPaidBillingEvents()).toEqual({ scanned: 1, applied: 1, failed: 0 });
    expect(event.status).toBe("applied");
    expect(h.user.usageAccruedCents).toBe(0);
    expect(h.user.usageBilledTotalCents).toBe(1000);
    expect(h.ledger.regular).toBe(0);
    expect(h.stripe.invoices.create).toHaveBeenCalledTimes(1);
    expect(h.stripe.invoices.pay).toHaveBeenCalledTimes(1);
    expect(await production.recoverPaidBillingEvents()).toEqual({ scanned: 0, applied: 0, failed: 0 });
    expect(h.user.usageBilledTotalCents).toBe(1000);
  });

  test("stored paid charging invoice applies without replacement or second payment", async () => {
    const h = setupHarness({ regularCents: 1000 });
    const event = {
      _id: "event_1", status: "charging", source: "regular_usage", sourceId: "regular_usage:user_1:1", amountCents: 1000,
      userId: "user_1", userEmail: "user@example.com", stripeCustomerId: "cus_1", description: "Usage",
      stripeInvoiceId: "in_stored", stripeInvoiceItemId: "ii_stored", metadata: { bucket: "regular", amountCents: "1000" },
      updatedAt: new Date(0),
    };
    h.events.set("regular_usage|regular_usage:user_1:1|1000", event);
    h.invoices.set("in_stored", { id: "in_stored", customer: "cus_1", currency: "usd", status: "paid", amount_due: 1000, amount_paid: 1000, metadata: { billingEventId: "event_1", bucket: "regular", amountCents: "1000" } });
    h.invoiceItems.set("ii_stored", { id: "ii_stored", invoice: "in_stored", amount: 1000, metadata: { billingEventId: "event_1", bucket: "regular", amountCents: "1000" } });
    const recover = await loadChargingRecovery();
    await recover(Date.now());
    expect(event.status).toBe("applied");
    expect(h.user.usageAccruedCents).toBe(0);
    expect(h.ledger.regular).toBe(0);
    expect(h.stripe.invoices.create).not.toHaveBeenCalled();
    expect(h.stripe.invoices.pay).not.toHaveBeenCalled();
  });

  test("stored open invoice resumes only itself; invalid stored invoices go to manual review", async () => {
    const h = setupHarness({ regularCents: 1000 });
    const event: any = {
      _id: "event_1", status: "charging", source: "regular_usage", sourceId: "regular_usage:user_1:1", amountCents: 1000,
      userId: "user_1", userEmail: "user@example.com", stripeCustomerId: "cus_1", description: "Usage",
      stripeInvoiceId: "in_stored", stripeInvoiceItemId: "ii_stored", metadata: { bucket: "regular", amountCents: "1000" }, updatedAt: new Date(0),
    };
    h.events.set("regular_usage|regular_usage:user_1:1|1000", event);
    h.invoices.set("in_stored", { id: "in_stored", customer: "cus_1", currency: "usd", status: "open", amount_due: 1000, amount_paid: 0, metadata: { billingEventId: "event_1", bucket: "regular", amountCents: "1000" } });
    h.invoiceItems.set("ii_stored", { id: "ii_stored", invoice: "in_stored", amount: 1000, metadata: { billingEventId: "event_1", bucket: "regular", amountCents: "1000" } });
    const recover = await loadChargingRecovery();
    await recover(Date.now());
    expect(h.stripe.invoices.create).not.toHaveBeenCalled();
    expect(h.stripe.invoices.pay).toHaveBeenCalledWith("in_stored", {}, expect.any(Object));
    expect(event.status).toBe("applied");

    for (const invalid of [
      { customer: "cus_wrong", amount_due: 1000, currency: "usd" },
      { customer: "cus_1", amount_due: 999, currency: "usd" },
      { customer: "cus_1", amount_due: 1000, currency: "eur" },
    ]) {
      const bad = setupHarness({ regularCents: 1000 });
      const badEvent: any = { ...event, status: "charging", appliedAt: undefined, needsManualReview: false, stripeInvoiceId: "in_bad", stripeInvoiceItemId: "ii_bad", updatedAt: new Date(0) };
      bad.events.set("regular_usage|regular_usage:user_1:1|1000", badEvent);
      bad.invoices.set("in_bad", { id: "in_bad", status: "open", amount_paid: 0, metadata: { billingEventId: "event_1", bucket: "regular", amountCents: "1000" }, ...invalid });
      bad.invoiceItems.set("ii_bad", { id: "ii_bad", invoice: "in_bad", amount: 1000, metadata: { billingEventId: "event_1", bucket: "regular", amountCents: "1000" } });
      const recoverBad = await loadChargingRecovery();
      await recoverBad(Date.now());
      expect(badEvent.needsManualReview).toBe(true);
      expect(bad.stripe.invoices.create).not.toHaveBeenCalled();
      expect(bad.stripe.invoices.pay).not.toHaveBeenCalled();
    }
  });

  test("ambiguous charging event remains manual-review blocked across repeated recovery", async () => {
    const h = setupHarness({ regularCents: 1000 });
    const event: any = {
      _id: "event_1", status: "charging", source: "regular_usage", sourceId: "regular_usage:user_1:1", amountCents: 1000,
      userId: "user_1", userEmail: "user@example.com", stripeCustomerId: "cus_1", description: "Usage",
      metadata: { bucket: "regular", amountCents: "1000" }, updatedAt: new Date(0),
    };
    h.events.set("regular_usage|regular_usage:user_1:1|1000", event);
    const recover = await loadChargingRecovery();
    await recover(Date.now());
    await recover(Date.now());
    expect(event.status).toBe("charging");
    expect(event.needsManualReview).toBe(true);
    expect(event.manualReviewReason).toBe("ambiguous_invoice_creation");
    expect(h.stripe.invoices.create).not.toHaveBeenCalled();
    expect(h.stripe.invoices.pay).not.toHaveBeenCalled();
  });
});
