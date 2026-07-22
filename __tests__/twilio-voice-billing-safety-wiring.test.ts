import fs from "fs";
import path from "path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Twilio voice billing safety wiring", () => {
  test("webhook and reconciler converge on the identical idempotency key", () => {
    const webhook = read("pages/api/twilio/voice-status.ts");
    const reconciler = read("lib/billing/reconcileTwilioVoiceUsage.ts");
    expect(webhook).toContain("eventKey: `twilio_voice:${callSid}`");
    expect(reconciler).toContain("eventKey: `twilio_voice:${String(candidate.callSid)}`");
  });

  test("durable call candidates and accrual ledgers both enforce uniqueness", () => {
    const candidates = read("models/TwilioVoiceUsageCandidate.ts");
    const accruals = read("models/UsageAccrualLedger.ts");
    expect(candidates).toContain("callSid: { type: String, required: true, unique: true");
    expect(accruals).toContain("usage_accrual_tenant_bucket_event");
    expect(accruals).toContain("{ unique: true");
  });

  test("reconciliation runs every five minutes and calling fails closed", () => {
    const vercel = JSON.parse(read("vercel.json"));
    expect(
      vercel.crons.find((entry: any) => entry.path === "/api/cron/reconcile-billing")
        ?.schedule,
    ).toBe("*/5 * * * *");
    expect(read("lib/billing/checkCallingAllowed.ts")).toContain(
      "checkBillingMeterHealthy",
    );
    expect(read("pages/api/voice/agent-join.ts")).toContain(
      "Re-check immediately before emitting <Dial>",
    );
  });

  test("subaccount identity comes from signed AccountSid, never posted email", () => {
    const webhook = read("pages/api/twilio/voice-status.ts");
    expect(webhook).toContain("firstDefined(b.AccountSid, b.accountSid)");
    expect(webhook).toContain('findOne({ "twilio.accountSid": callbackAccountSid })');
    expect(webhook).toContain("signed AccountSid/email ownership mismatch");
    expect(webhook).not.toContain('select("twilio.authToken")');
  });

  test("signature failure can only fall back to an authoritative call fetch", () => {
    const webhook = read("pages/api/twilio/voice-status.ts");
    expect(webhook).toContain("authoritative Twilio call verification failed");
    expect(webhook).toContain("getPlatformTwilioClientScoped(callbackAccountSid)");
    expect(webhook).toContain("sanitizeTwilioSid((fetched as any)?.accountSid) === callbackAccountSid");
    expect(webhook).toContain("accepted callback via authoritative Call API verification");
    expect(webhook).toContain("apiVerifiedCall?.duration");
  });

  test("legacy shared voice callback has the same authoritative subaccount fallback", () => {
    const webhook = read("pages/api/twilio/status-callback.ts");
    expect(webhook).toContain('findOne({ "twilio.accountSid": callbackAccountSid })');
    expect(webhook).toContain("getPlatformTwilioClientScoped(callbackAccountSid)");
    expect(webhook).toContain("sanitizeTwilioSid((fetched as any)?.accountSid) === callbackAccountSid");
    expect(webhook).toContain("accepted callback via authoritative Call API verification");
    expect(webhook).toContain("apiVerifiedCall?.duration ?? params.get(\"CallDuration\")");
    const insertBlock = webhook.slice(
      webhook.indexOf("const setOnInsert: any = {"),
      webhook.indexOf("const set: any = {"),
    );
    expect(insertBlock).not.toContain("from:");
    expect(insertBlock).not.toContain("startedAt:");
  });
});
