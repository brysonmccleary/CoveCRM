const fs = require("fs");
const path = require("path");
const { computeAiVoiceUsageMinutes } = require("../lib/billing/aiVoiceUsage");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const MANUAL_TALK_RATE_PER_MIN = 0.022;
const AI_TALK_RATE_PER_MIN = 0.08;
function billableConnectedSeconds(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.ceil(durationSec / 60) * 60;
}
function amountCentsForBillableSeconds(billableSeconds, ratePerMinute) {
  if (!Number.isFinite(billableSeconds) || billableSeconds <= 0) return 0;
  if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) return 0;
  return Math.round((billableSeconds / 60) * ratePerMinute * 100);
}

describe("dialer connected-duration billing rules", () => {
  test("10-second connected calls bill one whole minute", () => {
    const rates = read("lib/billing/dialerRates.ts");
    expect(rates).toContain("MANUAL_TALK_RATE_PER_MIN = 0.022");
    const billableSeconds = billableConnectedSeconds(10);
    expect(billableSeconds).toBe(60);
    expect(amountCentsForBillableSeconds(billableSeconds, MANUAL_TALK_RATE_PER_MIN)).toBe(2);
  });

  test("61-second connected calls bill two whole minutes", () => {
    const rates = read("lib/billing/dialerRates.ts");
    expect(rates).toContain("AI_TALK_RATE_PER_MIN = 0.08");
    const billableSeconds = billableConnectedSeconds(61);
    expect(billableSeconds).toBe(120);
    expect(amountCentsForBillableSeconds(billableSeconds, AI_TALK_RATE_PER_MIN)).toBe(16);
  });

  test("zero-duration calls are never billable", () => {
    expect(billableConnectedSeconds(0)).toBe(0);
    expect(amountCentsForBillableSeconds(0, AI_TALK_RATE_PER_MIN)).toBe(0);
  });

  test("AI talk usage ledger is idempotent by callSid before billing", () => {
    const source = read("pages/api/ai-calls/usage.ts");
    const model = read("models/AICallUsageLedger.ts");
    expect(source).toContain("AICallUsageLedger.findOne({ callSid: sid })");
    expect(model).toContain("callSid: { type: String, required: true, unique: true");
    expect(source).toContain('source: "ai_voice_call"');
  });

  test("live-transfer usage duration stops at meterStoppedAtMs behaviorally", () => {
    const t0 = Date.UTC(2026, 6, 6, 12, 0, 0);
    const wallClockNowMs = t0 + 10 * 60 * 1000;
    const meterStoppedAtMs = t0 + 90 * 1000;

    expect(
      computeAiVoiceUsageMinutes(
        { callStartedAtMs: t0, meterStoppedAtMs },
        wallClockNowMs,
      ),
    ).toBe(1.5);
    expect(computeAiVoiceUsageMinutes({ callStartedAtMs: t0 }, meterStoppedAtMs)).toBe(1.5);
  });

  test("manual PSTN billing does not fall back to ring elapsed when Twilio duration is missing", () => {
    const source = read("pages/api/twilio/voice-status.ts");
    expect(source).toContain("manual PSTN billing deferred until Twilio connected duration is available");
    expect(source).not.toContain("? twilioDuration || elapsedCallbackSeconds");
  });

  test("AI session billing caps runaway checkpoints and forfeits the excess", () => {
    const source = read("lib/billing/trackAiDialerSessionUsage.ts");
    expect(source).toContain("MAX_SINGLE_CHECKPOINT_SECONDS = 6 * 60 * 60");
    expect(source).toContain("[BILLING][RUNAWAY-SESSION]");
    expect(source).toContain("billedSeconds: nextBilledSeconds");
    expect(source).toContain("runawayBillingComputedSeconds: newSeconds");
    expect(source).toContain("runawayBillingCappedSeconds: billableSeconds");
  });

  test("AI session runaway billing sets charge hold before invoice creation", () => {
    const source = read("lib/billing/trackAiDialerSessionUsage.ts");
    const userModel = read("models/User.ts");
    expect(source).toContain("AI_SESSION_DAILY_ALERT_CENTS = 5000");
    expect(source).toContain("[BILLING][CHARGE-HOLD]");
    expect(source).toContain("aiDialerBillingHold: true");
    expect(source).toContain("aiDialerBillingHoldClearedAt");
    expect(source.indexOf("if (holdReason)")).toBeLessThan(source.indexOf("createFinalizePayInvoice({"));
    expect(userModel).toContain("aiDialerBillingHold: { type: Boolean");
    expect(userModel).toContain("aiDialerBillingHoldClearedAt");
  });

  test("AI session reuse resets billing checkpoint fields with startedAt", () => {
    const source = read("pages/api/ai-calls/session.ts");
    expect(source).toContain("aiSession.startedAt = now");
    expect(source).toContain("(aiSession as any).billedSeconds = 0");
    expect(source).toContain("(aiSession as any).lastBilledAt = null");
    expect(source).toContain("(aiSession as any).finalBilledAt = null");
  });

  test("watchdog final-bills terminal sessions once and auto-stops stale running sessions", () => {
    const source = read("pages/api/ai-calls/watchdog.ts");
    expect(source).toContain("STALE_RUNNING_SESSION_MS = 2 * 60 * 60 * 1000");
    expect(source).toContain("finalBilledAt: null");
    expect(source).toContain("Auto-stopped stale running session");
    expect(source).toContain("$set: { finalBilledAt: new Date() }");
  });

  test("AI usage endpoint rejects posted-email/callSid owner mismatches before ledger or Stripe", () => {
    const source = read("pages/api/ai-calls/usage.ts");
    expect(source).toContain("[BILLING][OWNERSHIP-MISMATCH]");
    expect(source).toContain("postedEmail && postedEmail !== resolvedEmail");
    expect(source).toContain('return res.status(409).json({ ok: false, error: "Call ownership mismatch" })');
    expect(source.indexOf("[BILLING][OWNERSHIP-MISMATCH]")).toBeLessThan(
      source.indexOf("AICallUsageLedger.findOne({ callSid: sid })"),
    );
    expect(source.indexOf("[BILLING][OWNERSHIP-MISMATCH]")).toBeLessThan(
      source.indexOf("createFinalizePayInvoice({"),
    );
  });

  test("AI usage endpoint resolves billing owner only from callSid data", () => {
    const source = read("pages/api/ai-calls/usage.ts");
    expect(source).toContain("AICallRecording.findOne({ callSid: sid })");
    expect(source).toContain("resolvedEmail = cleanEmail((recording as any)?.userEmail)");
    expect(source).toContain("AICallSession.findById(resolvedSessionId)");
    expect(source).toContain("owner_not_resolved");
    expect(source).not.toContain("const email = cleanEmail(userEmail)");
  });

  test("central invoice helper asserts userEmail and Stripe customer identity before Stripe calls", () => {
    const source = read("lib/billing/trackUsage.ts");
    expect(source).toContain("[BILLING][IDENTITY-MISMATCH]");
    expect(source).toContain("expectedCustomerId !== String(customerId || \"\").trim()");
    expect(source.indexOf("[BILLING][IDENTITY-MISMATCH]")).toBeLessThan(
      source.indexOf("stripe.invoiceItems.create"),
    );
    expect(source.indexOf("[BILLING][IDENTITY-MISMATCH]")).toBeLessThan(
      source.indexOf("BillingEvent.findOneAndUpdate"),
    );
  });

  test("AI talk ledger and Stripe metadata carry billing identity", () => {
    const usage = read("pages/api/ai-calls/usage.ts");
    const ledger = read("models/AICallUsageLedger.ts");
    const trackUsage = read("lib/billing/trackUsage.ts");
    const sessionBilling = read("lib/billing/trackAiDialerSessionUsage.ts");
    expect(ledger).toContain("stripeCustomerId: { type: String");
    expect(usage).toContain("stripeCustomerId,");
    expect(usage).toContain("metadata: {");
    expect(usage).toContain("callSid: sid");
    expect(trackUsage).toContain("metadata: stripeMeta");
    expect(trackUsage).toContain("stripe.invoiceItems.create");
    expect(sessionBilling).toContain("metadata: { userEmail: email, sessionId }");
  });

  test("watchdog logs shared Stripe customer canaries", () => {
    const source = read("pages/api/ai-calls/watchdog.ts");
    expect(source).toContain("logSharedStripeCustomers");
    expect(source).toContain("[BILLING][SHARED-CUSTOMER]");
    expect(source).toContain("stripeCustomerId: { $exists: true");
  });

});
