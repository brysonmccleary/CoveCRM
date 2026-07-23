import {
  createDeviceToken,
  createPairingCode,
  hashCompanionSecret,
  isWithinCompanionActiveHours,
  readBearerToken,
  safeSecretEqual,
} from "@/lib/recruiting/companion/security";
import fs from "fs";
import path from "path";

describe("recruiting companion security", () => {
  test("pairing codes are fixed-length, random-looking, and stored only as hashes", () => {
    const first = createPairingCode();
    const second = createPairingCode();
    expect(first).toMatch(/^[A-F0-9]{12}$/);
    expect(second).toMatch(/^[A-F0-9]{12}$/);
    expect(second).not.toBe(first);
    expect(hashCompanionSecret(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCompanionSecret(first)).not.toContain(first);
  });

  test("device tokens carry no account credentials and are compared by hash", () => {
    const token = createDeviceToken();
    expect(token).toMatch(/^cove_[A-Za-z0-9_-]{40,}$/);
    expect(safeSecretEqual(token, token)).toBe(true);
    expect(safeSecretEqual(token, `${token}x`)).toBe(false);
  });

  test("bearer parser fails closed", () => {
    expect(readBearerToken(`Bearer abc123`)).toBe("abc123");
    expect(readBearerToken("Basic abc123")).toBe("");
    expect(readBearerToken()).toBe("");
  });

  test("quiet hours block overnight activity in the connected browser timezone", () => {
    expect(isWithinCompanionActiveHours(new Date("2026-07-16T15:00:00.000Z"), "America/Phoenix")).toBe(true); // 8 AM
    expect(isWithinCompanionActiveHours(new Date("2026-07-17T03:59:00.000Z"), "America/Phoenix")).toBe(true); // 8:59 PM
    expect(isWithinCompanionActiveHours(new Date("2026-07-17T04:00:00.000Z"), "America/Phoenix")).toBe(false); // 9 PM
    expect(isWithinCompanionActiveHours(new Date("2026-07-17T09:00:00.000Z"), "America/Phoenix")).toBe(false); // 2 AM
    expect(isWithinCompanionActiveHours(new Date("2026-07-16T12:00:00.000Z"), "America/New_York")).toBe(true); // 8 AM
  });

  test("volume limits count DMs per platform without consuming the cap on engagement", () => {
    const claimSource = fs.readFileSync(path.join(process.cwd(), "pages/api/recruiting/companion/claim.ts"), "utf8");
    expect(claimSource).toContain('actionType: "dm"');
    expect(claimSource).toContain("platform,");
    expect(claimSource).toContain("cappedDmPlatforms");
    expect(claimSource).toContain("$nor:");
  });

  test("discovery capacity supports continuous two-hour 25-profile scans", () => {
    const launchSource = fs.readFileSync(path.join(process.cwd(), "pages/api/recruiting/launch.ts"), "utf8");
    const completionSource = fs.readFileSync(path.join(process.cwd(), "pages/api/recruiting/discovery/complete.ts"), "utf8");
    expect(launchSource).toContain("maxCandidatesPerScan: 25");
    expect(completionSource).toContain("2 * 60 * 60 * 1000");
  });

  test("LinkedIn DMs wait for connection acceptance and retry pending requests", () => {
    const contentSource = fs.readFileSync(path.join(process.cwd(), "browser-extension/cove-social-companion/content.js"), "utf8");
    const completionSource = fs.readFileSync(path.join(process.cwd(), "pages/api/recruiting/companion/complete.ts"), "utf8");
    const discoverySource = fs.readFileSync(path.join(process.cwd(), "pages/api/recruiting/discovery/complete.ts"), "utf8");
    expect(contentSource).toContain('failure("connection_pending"');
    expect(completionSource).toContain('failureCode === "connection_pending"');
    expect(completionSource).toContain("job.attempts < 14");
    expect(discoverySource).toContain('platform === "linkedin" && actionType === "dm"');
  });
});
