import fs from "fs";
import path from "path";
import { pageAppearsSignedOut } from "@/lib/recruiting/cloud/browserbase";
import { HOSTED_SOCIAL_CONSENT_VERSION, sanitizeHostedAccount, shouldRunHostedAccount, transitionHostedAccount } from "@/lib/recruiting/cloud/lifecycle";
import { runHostedRecruitingSimulation } from "@/lib/recruiting/cloud/simulation";
import { recruitingErrorMessage } from "@/lib/recruiting/public-errors";

describe("hosted recruiting lifecycle", () => {
  test("runs the complete customer, safety, logout, reconnect, and cancellation simulation", () => {
    const simulation = runHostedRecruitingSimulation();
    expect(simulation.passed).toBe(true);
    expect(simulation.passedCount).toBe(simulation.total);
    expect(simulation.total).toBeGreaterThanOrEqual(30);
  });

  test("account state machine fails closed", () => {
    expect(transitionHostedAccount("connecting", "login_verified")).toBe("active");
    expect(transitionHostedAccount("active", "logout_detected")).toBe("reauth_required");
    expect(transitionHostedAccount("active", "pause")).toBe("paused");
    expect(transitionHostedAccount("paused", "resume")).toBe("active");
    expect(transitionHostedAccount("active", "cancel")).toBe("canceled");
    expect(() => transitionHostedAccount("canceled", "resume")).toThrow();
    expect(shouldRunHostedAccount("active")).toBe(true);
    expect(shouldRunHostedAccount("connecting")).toBe(false);
    expect(shouldRunHostedAccount("reauth_required")).toBe(false);
  });

  test("API responses cannot expose provider context or login session IDs", () => {
    expect(sanitizeHostedAccount({ _id: "a", providerContextId: "secret-context", loginSessionId: "secret-session", status: "active" }))
      .toEqual({ _id: "a", status: "active" });
  });

  test("signed-out detection recognizes platform login and checkpoint states", () => {
    expect(pageAppearsSignedOut("instagram", "https://instagram.com/accounts/login/", "Log in", true)).toBe(true);
    expect(pageAppearsSignedOut("instagram", "https://instagram.com/challenge/123", "Confirm it's you", false)).toBe(true);
    expect(pageAppearsSignedOut("instagram", "https://instagram.com/", "Your account is suspended", false)).toBe(true);
    expect(pageAppearsSignedOut("linkedin", "https://linkedin.com/checkpoint/challenge/", "Verify", false)).toBe(true);
    expect(pageAppearsSignedOut("linkedin", "https://linkedin.com/authwall", "Join LinkedIn", false)).toBe(true);
    expect(pageAppearsSignedOut("linkedin", "https://linkedin.com/feed/", "Welcome back", false)).toBe(false);
  });

  test("cloud login never asks CoveCRM for passwords or authentication codes", () => {
    const connect = fs.readFileSync(path.join(process.cwd(), "pages/api/recruiting/accounts/connect.ts"), "utf8");
    const model = fs.readFileSync(path.join(process.cwd(), "models/RecruitingCloudAccount.ts"), "utf8");
    const lifecycle = fs.readFileSync(path.join(process.cwd(), "lib/recruiting/cloud/lifecycle.ts"), "utf8");
    const provider = fs.readFileSync(path.join(process.cwd(), "lib/recruiting/cloud/browserbase.ts"), "utf8");
    expect(connect).not.toMatch(/req\.body\?\.(password|otp|code)/);
    expect(model).not.toMatch(/password|otp|authenticationCode/i);
    expect(connect).toContain("HOSTED_SOCIAL_CONSENT_VERSION");
    expect(lifecycle).toContain(HOSTED_SOCIAL_CONSENT_VERSION);
    expect(provider).toContain("recordSession: false");
    expect(provider).toContain("logSession: false");
  });

  test("customer-facing recruiting errors never expose infrastructure details", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "pages/recruiting/index.tsx"), "utf8");
    const connect = fs.readFileSync(path.join(process.cwd(), "pages/api/recruiting/accounts/connect.ts"), "utf8");
    const verify = fs.readFileSync(path.join(process.cwd(), "pages/api/recruiting/accounts/verify.ts"), "utf8");
    const accountApi = fs.readFileSync(path.join(process.cwd(), "pages/api/recruiting/accounts/index.ts"), "utf8");

    expect(page).not.toMatch(/data\.error|caught\?\.message/);
    expect(page).not.toContain('error ? "border-red');
    expect(page).toContain("Account connections are being prepared");
    expect(page).toContain("accountConnectionsAvailable");
    expect(connect).not.toMatch(/error\?\.message/);
    expect(verify).not.toMatch(/error\?\.message/);
    expect(accountApi).not.toMatch(/error\?\.message/);

    const message = recruitingErrorMessage(
      { error: "Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID." },
      "ACCOUNT_CONNECTION_UNAVAILABLE",
    );
    expect(message).toBe("Account connections are temporarily unavailable. Please try again shortly.");
    expect(message).not.toMatch(/browserbase|api[_ -]?key|project[_ -]?id/i);
  });

  test("cloud automation retains all relationship and exact-message safeguards", () => {
    const automation = fs.readFileSync(path.join(process.cwd(), "lib/recruiting/cloud/automation.ts"), "utf8");
    expect(automation).toContain("relation.followsYou");
    expect(automation).toContain("relation.following");
    expect(automation).toContain("priorConversation");
    expect(automation).toContain("exactText(textbox.element, job.message)");
    expect(automation).toContain("target_mismatch");
    expect(automation).toContain("control_ambiguous");
    expect(automation).toContain("closestInteractive");
    expect(automation).toContain("content_unavailable");
    expect(automation).toContain('searchInput.fill(query)');
    expect(automation).toContain("sentMessageVisible");
    expect(automation).toContain("linkedinLikeConfirmed");
    expect(automation).toContain('svg[aria-label="Unlike"]');
    expect(automation).toContain("confirmedRelationship");
  });

  test("worker is server-side, leased, quiet-hour gated, and caps every action type", () => {
    const worker = fs.readFileSync(path.join(process.cwd(), "lib/recruiting/cloud/worker.ts"), "utf8");
    const indexes = fs.readFileSync(path.join(process.cwd(), "scripts/create-indexes.ts"), "utf8");
    expect(worker).toContain("workerLeaseExpiresAt");
    expect(worker).toContain("isWithinCompanionActiveHours");
    expect(worker).toContain("PLATFORM_ACTION_TYPES");
    expect(worker).toContain("actionType: { $nin: cappedTypes }");
    expect(worker).toContain("markReauthenticationRequired");
    expect(worker).toContain("prerequisite_failed");
    expect(indexes).toContain("ensureRecruitingCloudIndexes");
    expect(indexes).toContain("RecruitingGrowthSnapshot.createIndexes()");
  });

  test("insights count completed actions as targeted interactions without inventing growth", () => {
    const insightsApi = fs.readFileSync(path.join(process.cwd(), "pages/api/recruiting/insights.ts"), "utf8");
    const insightsPage = fs.readFileSync(path.join(process.cwd(), "pages/recruiting/insights.tsx"), "utf8");
    expect(insightsApi).toContain('status: "succeeded"');
    expect(insightsApi).toContain("targetedInteractions: totalFor()");
    expect(insightsApi).toContain("Follower and connection growth begins after the first connected-account baseline");
    expect(insightsPage).toContain("Every completed like, story like, follow, connection, or DM counts as one targeted interaction.");
    expect(insightsPage).not.toContain("unique people");
  });
});
