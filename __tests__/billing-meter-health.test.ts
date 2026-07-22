describe("billing meter fail-closed gate", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function setup(health: any) {
    const lean = jest.fn().mockResolvedValue(health);
    const select = jest.fn(() => ({ lean }));
    const findOne = jest.fn(() => ({ select }));
    jest.doMock("@/models/BillingMeterHealth", () => ({
      __esModule: true,
      default: { findOne },
    }));
    return { findOne };
  }

  test("allows a recently successful healthy subaccount meter", async () => {
    setup({ status: "healthy", lastSucceededAt: new Date("2026-07-22T10:00:00Z") });
    const { checkBillingMeterHealthy } = await import(
      "@/lib/billing/billingMeterHealth"
    );
    await expect(
      checkBillingMeterHealthy({
        accountSid: "AC11111111111111111111111111111111",
        now: new Date("2026-07-22T10:10:00Z"),
      }),
    ).resolves.toEqual({ ok: true });
  });

  test("blocks when the reconciler is stale", async () => {
    setup({ status: "healthy", lastSucceededAt: new Date("2026-07-22T09:00:00Z") });
    const { checkBillingMeterHealthy } = await import(
      "@/lib/billing/billingMeterHealth"
    );
    const result = await checkBillingMeterHealthy({
      accountSid: "AC11111111111111111111111111111111",
      now: new Date("2026-07-22T10:00:00Z"),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("paused");
  });

  test("blocks an uninitialized subaccount meter", async () => {
    setup(null);
    const { checkBillingMeterHealthy } = await import(
      "@/lib/billing/billingMeterHealth"
    );
    const result = await checkBillingMeterHealthy({
      accountSid: "AC11111111111111111111111111111111",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("initializing");
  });
});
