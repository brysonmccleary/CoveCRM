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
    expect(source).toContain("alreadyBilled: true");
    expect(source.indexOf("AICallUsageLedger.findOne({ callSid: sid })")).toBeLessThan(
      source.indexOf("AICallRecording.findOne({ callSid: sid })"),
    );
  });

  test("duplicate AI usage POST returns alreadyBilled before any Stripe-capable accrual", () => {
    const source = read("pages/api/ai-calls/usage.ts");
    expect(source).toContain("alreadyBilled: true");
    expect(source).toContain('reason: `ledger_${String((existingLedger as any).status || "exists")}`');
    expect(source.indexOf("if (existingLedger)")).toBeLessThan(
      source.indexOf("trackAiDialerCentsUsage({"),
    );
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

  test("AI session runaway checkpoint protection remains separate from threshold amount", () => {
    const source = read("lib/billing/trackAiDialerSessionUsage.ts");
    expect(source).not.toContain("AI_SESSION_DAILY_ALERT_CENTS");
    expect(source).not.toContain("daily_ai_session_accrual_exceeded");
    expect(source.indexOf("if (holdReason)")).toBeLessThan(source.indexOf("createFinalizePayInvoice({"));
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
      source.indexOf("trackAiDialerCentsUsage({"),
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

  test("central invoice helper validates the exact standalone invoice before internal application", () => {
    const source = read("lib/billing/standaloneInvoice.ts");
    expect(source).toContain("pending_invoice_items_behavior: \"exclude\"");
    expect(source).toContain("invoice: invoiceId");
    expect(source).toContain("Standalone invoice validation failed");
    expect(source).toContain("amount_due");
    expect(source).toContain("amount_paid");
  });

  test("AI talk ledger and Stripe metadata carry billing identity", () => {
    const usage = read("pages/api/ai-calls/usage.ts");
    const ledger = read("models/AICallUsageLedger.ts");
    const invoice = read("lib/billing/standaloneInvoice.ts");
    const sessionBilling = read("lib/billing/trackAiDialerSessionUsage.ts");
    expect(ledger).toContain("stripeCustomerId: { type: String");
    expect(usage).toContain("stripeCustomerId,");
    expect(usage).toContain("metadata: {");
    expect(usage).toContain("callSid: sid");
    expect(invoice).toContain("billingEventId");
    expect(invoice).toContain("stripe.invoiceItems.create");
    expect(sessionBilling).toContain("metadata: { userEmail: email, sessionId }");
  });

  test("AI talk charges accrue to the threshold bucket instead of per-call invoicing", () => {
    const usage = read("pages/api/ai-calls/usage.ts");
    const ledger = read("models/AICallUsageLedger.ts");
    const sessionBilling = read("lib/billing/trackAiDialerSessionUsage.ts");
    expect(usage).toContain("trackAiDialerCentsUsage({");
    expect(usage).toContain('status: "accrued"');
    expect(usage).not.toContain("createFinalizePayInvoice({");
    expect(ledger).toContain('"accrued"');
    expect(sessionBilling).toContain("aiDialerAccruedSessionCents: cents");
    expect(sessionBilling).toContain("newAccrued < SESSION_THRESHOLD_CENTS");
    expect(sessionBilling).toContain("getPendingAccrualLedgerCents({");
    expect(sessionBilling).toContain("ledgerPendingCents >= SESSION_THRESHOLD_CENTS ? SESSION_THRESHOLD_CENTS : 0");
    expect(sessionBilling).toContain("[BILLING][PRE-LEDGER-BALANCE-DRIFT]");
    expect(sessionBilling).toContain("applyPaidBillingEvent");
    expect(sessionBilling).toContain("charged: true");
  });

  test("AI voice bucket has per-event ledgers and ceils session minutes", () => {
    const sessionBilling = read("lib/billing/trackAiDialerSessionUsage.ts");
    const ledger = read("models/UsageAccrualLedger.ts");
    expect(sessionBilling).toContain("const billableMinutes = billableSeconds > 0 ? Math.ceil(billableSeconds / 60) : 0");
    expect(sessionBilling).toContain("recordUsageAccrualOnce({");
    expect(sessionBilling).toContain("getPendingAccrualLedgerCents({");
    expect(sessionBilling).toContain('bucket: "ai_voice"');
    expect(sessionBilling).toContain('eventKey: `ai_voice:${eventKey}`');
    expect(sessionBilling).toContain("applyPaidBillingEvent");
    expect(ledger).toContain('export type UsageAccrualBucket = "regular" | "ai_voice"');
    expect(ledger).toContain("usage_accrual_tenant_bucket_event");
  });

  test("AI dialer transcripts route to AI voice bucket and regular transcripts stay regular", () => {
    const aiTranscript = read("pages/api/ai-calls/transcribe-recording.ts");
    const regularTranscript = read("pages/api/calls/transcribe-recording.ts");
    const aiTurnsTranscript = read("pages/api/ai-calls/transcript.ts");
    expect(aiTranscript).toContain("trackAiDialerCentsUsage({");
    expect(aiTranscript).toContain('source: "ai_transcript"');
    expect(aiTranscript).toContain('eventKey: `recording-transcript:${String(rec.callSid || rec._id)}`');
    expect(aiTranscript).not.toContain("trackUsage({");
    expect(aiTurnsTranscript).toContain('billingOrigin: "dialer"');
    expect(regularTranscript).toContain('aiInsightsBillingOrigin: "regular"');
    expect(regularTranscript).toContain('eventKey: `openai:call-transcript:${String(args.callId)}`');
  });

  test("regular usage has per-event idempotency and inbound SMS transport billing", () => {
    const trackUsage = read("lib/billing/trackUsage.ts");
    const inbound = read("pages/api/twilio/inbound-sms.ts");
    const legacy = read("pages/api/twilio/receive-sms.ts");
    expect(trackUsage).toContain("Missing usage eventKey");
    expect(trackUsage).toContain("ledgerPendingCents >= TOPUP_AMOUNT_CENTS ? TOPUP_AMOUNT_CENTS : 0");
    expect(trackUsage).toContain("[BILLING][PRE-LEDGER-BALANCE-DRIFT]");
    expect(trackUsage).toContain("applyUsageBillingEvent");
    expect(trackUsage).toContain('bucket: "regular"');
    expect(inbound).toContain('eventKey: `sms:${messageSid || String(savedMessage._id)}`');
    expect(inbound).toContain("amount: 0.02 * numSegments");
    expect(legacy).toContain("legacy endpoint forwarded to /api/twilio/inbound-sms");
    expect(legacy).not.toContain("usageBalance");
  });

  test("watchdog has no automatic threshold backlog drain", () => {
    const watchdog = read("pages/api/ai-calls/watchdog.ts");
    expect(watchdog).not.toContain("AUTOMATIC_USAGE_BACKLOG_DRAIN_ENABLED");
    expect(watchdog).not.toContain("chargeRegularUsageThresholdIfDue");
    expect(watchdog).toContain("allowThresholdCharge: false");
  });

  test("AI voice prompt contains ARC depth and agent-name guard", () => {
    const source = read("ai-voice-server/index.ts");
    expect(source).toContain("HARD AGENT NAME LOCK (NON-NEGOTIABLE)");
    expect(source).toContain("NEVER substitute any other agent name, company, carrier, or brand");
    expect(source).toContain("If unsure, say exactly: \"the agent\"");
    expect(source).toContain("I'm ${aiName}, ${agentFirst}'s scheduling assistant — this is about the ${getScopeLabelForScriptKey(ctx.scriptKey)} request that came in.");
    expect(source).toContain("they requested this information and others were glad they took a few minutes to receive it");
    expect(source).toContain("${agent} will make it extremely short");
    expect(source).toContain("For busy or no-time objections, preserve all three beats");
    expect(source).toContain("Max 4 sentences total");
  });

});
