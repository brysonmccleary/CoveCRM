import fs from "fs";
import path from "path";
import {
  DM_RAMP_WEEK_ONE_LIMIT,
  DM_RAMP_WEEK_TWO_LIMIT,
  effectiveDailyDmLimit,
  MAX_DAILY_DM_LIMIT,
} from "@/lib/recruiting/dm-settings";
import {
  ACTION_INTERVAL_JITTER_MS,
  jitteredActionIntervalMs,
  MIN_ACTION_INTERVAL_MS,
} from "@/lib/recruiting/companion/security";
import { normalizeRecruitingPlan } from "@/lib/recruiting/plans";
import { isSupportedAutomationLanguage } from "@/lib/recruiting/cloud/browserbase";
import { parseCompactCount } from "@/lib/recruiting/cloud/automation";

jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue({ ok: true }) }));
jest.mock("@/models/RecruitingAuditEvent", () => ({
  __esModule: true,
  default: { countDocuments: jest.fn(), updateOne: jest.fn(), create: jest.fn() },
}));

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("plan entitlement fails closed", () => {
  test("unknown or missing plan values resolve to the restrictive plan, never the paid-DM tier", () => {
    expect(normalizeRecruitingPlan("not-a-plan")).toBe("growth");
    expect(normalizeRecruitingPlan(undefined)).toBe("growth");
    expect(normalizeRecruitingPlan(null)).toBe("growth");
    expect(normalizeRecruitingPlan("")).toBe("growth");
    expect(normalizeRecruitingPlan("growth")).toBe("growth");
    expect(normalizeRecruitingPlan("growth_recruiting")).toBe("growth_recruiting");
  });

  test("worker refuses accounts whose owner has no recruiting entitlement", async () => {
    const { ownerHasRecruitingEntitlement } = require("@/lib/recruiting/access");
    await expect(ownerHasRecruitingEntitlement("bryson.mccleary1@gmail.com")).resolves.toBe(true);
    await expect(ownerHasRecruitingEntitlement("stranger@example.com")).resolves.toBe(false);
    await expect(ownerHasRecruitingEntitlement("")).resolves.toBe(false);
    await expect(ownerHasRecruitingEntitlement(null)).resolves.toBe(false);

    const workerSource = source("lib/recruiting/cloud/worker.ts");
    expect(workerSource).toContain("ownerHasRecruitingEntitlement(account.ownerEmail)");
    expect(workerSource).toContain('type: "not_entitled"');
  });
});

describe("DM warm-up ramp", () => {
  const now = new Date("2026-08-01T18:00:00.000Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  test("week one is capped at 10 regardless of the configured limit", () => {
    expect(effectiveDailyDmLimit(daysAgo(0), now, 50)).toBe(DM_RAMP_WEEK_ONE_LIMIT);
    expect(effectiveDailyDmLimit(daysAgo(6.9), now, 50)).toBe(DM_RAMP_WEEK_ONE_LIMIT);
  });

  test("week two is capped at 25, then the configured limit applies", () => {
    expect(effectiveDailyDmLimit(daysAgo(7), now, 50)).toBe(DM_RAMP_WEEK_TWO_LIMIT);
    expect(effectiveDailyDmLimit(daysAgo(13.9), now, 50)).toBe(DM_RAMP_WEEK_TWO_LIMIT);
    expect(effectiveDailyDmLimit(daysAgo(14), now, 50)).toBe(50);
    expect(effectiveDailyDmLimit(daysAgo(365), now, 50)).toBe(MAX_DAILY_DM_LIMIT);
  });

  test("a customer limit lower than the ramp always wins", () => {
    expect(effectiveDailyDmLimit(daysAgo(0), now, 5)).toBe(5);
    expect(effectiveDailyDmLimit(daysAgo(10), now, 5)).toBe(5);
    expect(effectiveDailyDmLimit(daysAgo(30), now, 5)).toBe(5);
  });

  test("unknown account age fails closed to the week-one cap", () => {
    expect(effectiveDailyDmLimit(null, now, 50)).toBe(DM_RAMP_WEEK_ONE_LIMIT);
    expect(effectiveDailyDmLimit(undefined, now, 50)).toBe(DM_RAMP_WEEK_ONE_LIMIT);
  });

  test("worker caps every action type against its ramped ceiling, not just DMs", () => {
    const workerSource = source("lib/recruiting/cloud/worker.ts");
    expect(workerSource).toContain("effectiveDailyActionLimit(actionType, account.createdAt, now, account.dailyDmLimit)");
    expect(workerSource).toContain("cappedTypes");
    expect(workerSource).toContain("actionType: { $nin: cappedTypes }");
    expect(workerSource).not.toContain("dmCount >= account.dailyDmLimit");
  });
});

describe("all action types ramp and cap, not just DMs", () => {
  const now = new Date("2026-08-01T18:00:00.000Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const { effectiveDailyActionLimit, MATURE_DAILY_ACTION_LIMITS, warmupFraction } = require("@/lib/recruiting/dm-settings");

  test("mature accounts get the full per-action ceiling", () => {
    expect(effectiveDailyActionLimit("like_post", daysAgo(90), now, 25)).toBe(MATURE_DAILY_ACTION_LIMITS.like_post);
    expect(effectiveDailyActionLimit("follow", daysAgo(90), now, 25)).toBe(MATURE_DAILY_ACTION_LIMITS.follow);
    expect(effectiveDailyActionLimit("connect", daysAgo(90), now, 25)).toBe(MATURE_DAILY_ACTION_LIMITS.connect);
  });

  test("fresh accounts ramp likes/follows/connections over three weeks", () => {
    expect(warmupFraction(2)).toBe(0.25);
    expect(warmupFraction(10)).toBe(0.5);
    expect(warmupFraction(17)).toBe(0.75);
    expect(warmupFraction(30)).toBe(1);
    // Week one follows are a quarter of the mature cap, never the full number.
    expect(effectiveDailyActionLimit("follow", daysAgo(1), now, 25)).toBe(Math.floor(MATURE_DAILY_ACTION_LIMITS.follow * 0.25));
    expect(effectiveDailyActionLimit("like_post", daysAgo(1), now, 25)).toBeLessThan(MATURE_DAILY_ACTION_LIMITS.like_post);
  });

  test("unknown account age fails closed to the most conservative ramp step", () => {
    expect(effectiveDailyActionLimit("follow", null, now, 25)).toBe(Math.floor(MATURE_DAILY_ACTION_LIMITS.follow * 0.25));
  });

  test("the DM path stays on its own stricter customer-configurable ramp", () => {
    const { effectiveDailyDmLimit } = require("@/lib/recruiting/dm-settings");
    expect(effectiveDailyActionLimit("dm", daysAgo(90), now, 40)).toBe(effectiveDailyDmLimit(daysAgo(90), now, 40));
  });
});

describe("per-account residential proxy IPs", () => {
  const { geolocationForTimeZone } = require("@/lib/recruiting/social/geo");
  const { hostedResidentialProxyEnabled } = require("@/lib/recruiting/cloud/browserbase");

  test("each timezone maps to a stable U.S. geolocation, unknown fails closed to country-only US", () => {
    expect(geolocationForTimeZone("America/New_York")).toEqual({ country: "US", state: "NY", city: "New York" });
    expect(geolocationForTimeZone("America/Phoenix")).toEqual({ country: "US", state: "AZ", city: "Phoenix" });
    expect(geolocationForTimeZone("Europe/London")).toEqual({ country: "US" });
    expect(geolocationForTimeZone("")).toEqual({ country: "US" });
  });

  test("residential proxying is ON by default and only disabled by an explicit opt-out", () => {
    const original = process.env.RECRUITING_RESIDENTIAL_PROXY_ENABLED;
    try {
      delete process.env.RECRUITING_RESIDENTIAL_PROXY_ENABLED;
      expect(hostedResidentialProxyEnabled()).toBe(true);
      process.env.RECRUITING_RESIDENTIAL_PROXY_ENABLED = "false";
      expect(hostedResidentialProxyEnabled()).toBe(false);
      process.env.RECRUITING_RESIDENTIAL_PROXY_ENABLED = "true";
      expect(hostedResidentialProxyEnabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.RECRUITING_RESIDENTIAL_PROXY_ENABLED;
      else process.env.RECRUITING_RESIDENTIAL_PROXY_ENABLED = original;
    }
  });

  test("browserbase attaches residential proxies with the account geolocation to every session", () => {
    const bb = source("lib/recruiting/cloud/browserbase.ts");
    expect(bb).toContain('type: "browserbase", geolocation');
    expect(bb).toContain("...proxyConfiguration(params.geolocation)");
    // Login sessions and worker sessions both carry geolocation.
    expect(bb).toContain("geolocation: params.geolocation");
  });

  test("connect pins a geolocation on the account and the worker reuses it for every session", () => {
    const connect = source("pages/api/recruiting/accounts/connect.ts");
    expect(connect).toContain("geolocationForTimeZone(timeZone)");
    expect(connect).toContain("proxyGeolocation");
    const workerSource = source("lib/recruiting/cloud/worker.ts");
    expect(workerSource).toContain("account.proxyGeolocation || geolocationForTimeZone");
    // All three session types receive it.
    expect(workerSource.match(/geolocation,/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("action spacing jitter", () => {
  test("every drawn interval falls in [90s, 180s)", () => {
    for (let i = 0; i < 500; i += 1) {
      const interval = jitteredActionIntervalMs();
      expect(interval).toBeGreaterThanOrEqual(MIN_ACTION_INTERVAL_MS);
      expect(interval).toBeLessThan(MIN_ACTION_INTERVAL_MS + ACTION_INTERVAL_JITTER_MS);
    }
  });

  test("intervals actually vary (not a fixed cadence)", () => {
    const draws = new Set(Array.from({ length: 100 }, () => jitteredActionIntervalMs()));
    expect(draws.size).toBeGreaterThan(1);
  });

  test("worker cooldown uses the jittered interval", () => {
    const workerSource = source("lib/recruiting/cloud/worker.ts");
    expect(workerSource).toContain("sinceLast < jitteredActionIntervalMs()");
    expect(workerSource).not.toContain("sinceLast < MIN_ACTION_INTERVAL_MS");
  });
});

describe("worker kill switch", () => {
  const originalFlag = process.env.RECRUITING_CLOUD_WORKER_DISABLED;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.RECRUITING_CLOUD_WORKER_DISABLED;
    else process.env.RECRUITING_CLOUD_WORKER_DISABLED = originalFlag;
  });

  test("RECRUITING_CLOUD_WORKER_DISABLED=true halts all processing before any DB or browser work", async () => {
    process.env.RECRUITING_CLOUD_WORKER_DISABLED = "true";
    const { processRecruitingCloudWork } = require("@/lib/recruiting/cloud/worker");
    // mongooseConnect would throw without a DB; returning cleanly proves the
    // kill switch short-circuits ahead of every side effect.
    await expect(processRecruitingCloudWork(5)).resolves.toEqual({ processed: 0, results: [], disabled: true });
  });
});

describe("English-language account requirement", () => {
  test("explicitly non-English account UIs are rejected; English and unknown pass", () => {
    expect(isSupportedAutomationLanguage("en")).toBe(true);
    expect(isSupportedAutomationLanguage("en-US")).toBe(true);
    expect(isSupportedAutomationLanguage("EN-GB")).toBe(true);
    expect(isSupportedAutomationLanguage("")).toBe(true);
    expect(isSupportedAutomationLanguage("es")).toBe(false);
    expect(isSupportedAutomationLanguage("fr-FR")).toBe(false);
    expect(isSupportedAutomationLanguage("pt-BR")).toBe(false);
  });

  test("verify endpoint blocks connection with an actionable message", () => {
    const verifySource = source("pages/api/recruiting/accounts/verify.ts");
    expect(verifySource).toContain("verification.languageSupported");
    expect(verifySource).toContain("ACCOUNT_LANGUAGE_UNSUPPORTED");
    const messages = require("@/lib/recruiting/public-errors").RECRUITING_PUBLIC_MESSAGES;
    expect(messages.ACCOUNT_LANGUAGE_UNSUPPORTED).toMatch(/English/);
  });
});

describe("automation health alerts", () => {
  const RecruitingAuditEvent = require("@/models/RecruitingAuditEvent").default;
  const { sendEmail } = require("@/lib/email");

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.RECRUITING_ALERT_FAILURE_THRESHOLD;
  });

  test("below the threshold nothing is sent", async () => {
    const { maybeSendAutomationHealthAlert } = require("@/lib/recruiting/cloud/alerts");
    RecruitingAuditEvent.countDocuments.mockResolvedValue(2);

    await maybeSendAutomationHealthAlert("action_failures", "instagram");

    expect(RecruitingAuditEvent.updateOne).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("at the threshold the admin gets exactly one email, deduped by day", async () => {
    const { maybeSendAutomationHealthAlert } = require("@/lib/recruiting/cloud/alerts");
    RecruitingAuditEvent.countDocuments.mockResolvedValue(5);
    RecruitingAuditEvent.updateOne.mockResolvedValueOnce({ upsertedCount: 1 });

    await maybeSendAutomationHealthAlert("action_failures", "instagram");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toBe("bryson.mccleary1@gmail.com");
    expect(sendEmail.mock.calls[0][1]).toContain("instagram");

    // Second spike the same day: the upsert loses, no duplicate email.
    RecruitingAuditEvent.updateOne.mockResolvedValueOnce({ upsertedCount: 0 });
    await maybeSendAutomationHealthAlert("action_failures", "instagram");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test("qualification failures use their own counter and message", async () => {
    const { maybeSendAutomationHealthAlert } = require("@/lib/recruiting/cloud/alerts");
    RecruitingAuditEvent.countDocuments.mockResolvedValue(7);
    RecruitingAuditEvent.updateOne.mockResolvedValue({ upsertedCount: 1 });

    await maybeSendAutomationHealthAlert("qualification_failures", "linkedin");

    expect(RecruitingAuditEvent.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "discovery_qualification_failed" }),
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(String(sendEmail.mock.calls[0][2])).toContain("RECRUITING_QUALIFICATION_MODEL");
  });

  test("worker and discovery are wired into the alerts", () => {
    const workerSource = source("lib/recruiting/cloud/worker.ts");
    expect(workerSource).toContain('maybeSendAutomationHealthAlert("action_failures", job.platform)');
    const discoverySource = source("lib/recruiting/cloud/discovery.ts");
    expect(discoverySource).toContain('eventType: "discovery_qualification_failed"');
    expect(discoverySource).toContain('maybeSendAutomationHealthAlert("qualification_failures", platform)');
  });
});

describe("stay-logged-in persistence and re-login tolerance", () => {
  const { nextSignedOutState, SIGNED_OUT_STRIKE_LIMIT, SUSPECTED_LOGOUT_RETRY_MS } = require("@/lib/recruiting/companion/security");

  test("one signed-out blip does not force reconnect; a confirmed repeat does", () => {
    const first = nextSignedOutState(0);
    expect(first.escalate).toBe(false);
    expect(first.strikes).toBe(1);
    const second = nextSignedOutState(first.strikes);
    expect(second.escalate).toBe(true);
    expect(second.strikes).toBe(0); // reset so a reconnected account starts clean
  });

  test("strike threshold and short retry window are conservative", () => {
    expect(SIGNED_OUT_STRIKE_LIMIT).toBeGreaterThanOrEqual(2);
    expect(nextSignedOutState(undefined).escalate).toBe(false);
    expect(SUSPECTED_LOGOUT_RETRY_MS).toBeLessThan(60 * 60 * 1000); // retries sooner than the reauth backoff
  });

  test("the one-time login is reused via a persistent browser context on every session", () => {
    const bb = source("lib/recruiting/cloud/browserbase.ts");
    // Persistent context = the login cookies are saved once and reused, so the
    // customer does not log in again on each run.
    expect(bb).toContain("context: { id: params.contextId, persist: true }");
    // The one-time login context is only destroyed on explicit cancellation.
    const accounts = source("pages/api/recruiting/accounts/index.ts");
    expect(accounts).toContain("deleteHostedContext(account.providerContextId)");
    const verify = source("pages/api/recruiting/accounts/verify.ts");
    expect(verify).toContain('account.status = "active"');
  });

  test("worker tolerates a blip and resets strikes once the session is confirmed live", () => {
    const workerSource = source("lib/recruiting/cloud/worker.ts");
    expect(workerSource).toContain("registerSignedOut");
    expect(workerSource).toContain("nextSignedOutState(account.signedOutStrikes)");
    expect(workerSource).toContain('"logout_suspected"');
    expect(workerSource).toContain("account.signedOutStrikes = 0");
    // The tolerated path retries on the short window, not the hour-long reauth backoff.
    expect(workerSource).toContain("SUSPECTED_LOGOUT_RETRY_MS");
    const model = source("models/RecruitingCloudAccount.ts");
    expect(model).toContain("signedOutStrikes");
  });
});

describe("customers can edit a running campaign safely (update endpoint)", () => {
  const updateSource = source("pages/api/recruiting/update-campaign.ts");

  test("only running or paused hosted campaigns owned by the caller can be edited", () => {
    expect(updateSource).toContain("requireRecruitingAdmin");
    expect(updateSource).toContain('executionMode: "hosted_cloud"');
    expect(updateSource).toContain('status: { $in: ["active", "paused"] }');
    expect(updateSource).toContain("ownerEmail: admin.email");
  });

  test("editing the message never re-messages anyone already contacted", () => {
    // Only queued (not-yet-sent) DMs are canceled; succeeded/claimed are untouched,
    // and the pipeline's per-person DM guard still blocks any duplicate.
    expect(updateSource).toContain('actionType: "dm", status: "queued"');
    expect(updateSource).toContain('failureCode: "message_updated"');
    const discoverySource = source("lib/recruiting/cloud/discovery.ts");
    expect(discoverySource).toContain("priorCoveDm");
  });

  test("turning an action off cancels its queued work", () => {
    expect(updateSource).toContain("actionType: { $nin: actions }");
    expect(updateSource).toContain('failureCode: "settings_updated"');
  });

  test("edits are validated and plan-gated exactly like launch", () => {
    expect(updateSource).toContain("validateRecruitingAudienceDescription");
    expect(updateSource).toContain("assertPlanAllowsCampaign");
    expect(updateSource).toContain("parseDailyDmLimit");
    expect(updateSource).toContain("UNSUPPORTED_MESSAGE_CLAIM");
  });

  test("audience edits re-point discovery in place and re-scan when running", () => {
    expect(updateSource).toContain("buildDiscoverySearchQueries");
    expect(updateSource).toContain("RecruitingDiscoveryJob.updateOne");
    expect(updateSource).toContain("sourceCursor: 0");
    expect(updateSource).toContain('set.status = "queued"; set.availableAt = now;');
    // The discovery fields being re-pointed are no longer immutable.
    const discoveryModel = source("models/RecruitingDiscoveryJob.ts");
    expect(discoveryModel).not.toMatch(/audienceDescription:[^\n]*immutable: true/);
    expect(discoveryModel).not.toMatch(/searchQuery:[^\n]*immutable: true/);
  });

  test("every edit is audited and the campaign version bumps", () => {
    expect(updateSource).toContain('eventType: "campaign_updated"');
    expect(updateSource).toContain("campaign.version");
    const auditModel = source("models/RecruitingAuditEvent.ts");
    expect(auditModel).toContain('"campaign_updated"');
  });

  test("the edit UI pre-fills from current settings and saves via the update endpoint", () => {
    const ui = source("pages/recruiting/index.tsx");
    expect(ui).toContain('fetch("/api/recruiting/update-campaign"');
    expect(ui).toContain("beginEdit");
    expect(ui).toContain("runningCampaign?.settings");
    // Overview exposes the settings the edit panel needs.
    const overview = source("pages/api/recruiting/overview.ts");
    expect(overview).toContain("settings:");
  });
});

describe("the customer view stays calm — no machinery, no live automation", () => {
  const ui = source("pages/recruiting/index.tsx");

  test("the builder is hidden once a campaign is running (shown only for setup or editing)", () => {
    expect(ui).toContain("const showBuilder = !hasCampaign || editing");
    expect(ui).toContain("{showBuilder &&");
  });

  test("a live browser view can never be attached to a background worker session", () => {
    // The only place a live view is generated is the one-time login. The worker
    // path (withHostedPage) must never reference it — this guards against a
    // future change accidentally streaming the automation to the customer.
    const bb = source("lib/recruiting/cloud/browserbase.ts");
    const workerBlock = bb.slice(bb.indexOf("export async function withHostedPage"));
    expect(workerBlock).not.toContain("getHostedLiveView");
    expect(workerBlock).not.toContain("liveViewUrl");
    // Live view is only wired into the login flow and the connect endpoint.
    expect(bb).toContain("const liveViewUrl = await getHostedLiveView");
    const worker = source("lib/recruiting/cloud/worker.ts");
    expect(worker).not.toContain("getHostedLiveView");
    expect(worker).not.toContain("liveViewUrl");
  });
});

describe("small correctness fixes", () => {
  test("compact follower counts parse with or without a space before the suffix", () => {
    expect(parseCompactCount("1,234")).toBe(1234);
    expect(parseCompactCount("12.5k")).toBe(12500);
    expect(parseCompactCount("12.5 K")).toBe(12500);
    expect(parseCompactCount("3.4m")).toBe(3400000);
    expect(parseCompactCount("2 B")).toBe(2000000000);
    expect(parseCompactCount("followers")).toBeNull();
    expect(parseCompactCount("")).toBeNull();
  });

  test("spot-test simulation is allowed against launched campaigns", () => {
    const simulateSource = source("pages/api/recruiting/simulate.ts");
    expect(simulateSource).toContain('"active"');
  });
});
