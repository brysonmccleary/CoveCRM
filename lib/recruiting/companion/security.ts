import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const COMPANION_CONSENT_VERSION = "2026-07-16.1";
export const PAIRING_TTL_MS = 15 * 60 * 1000;
export const JOB_LEASE_MS = 5 * 60 * 1000;
export const MIN_ACTION_INTERVAL_MS = 90 * 1000;
export const DEFAULT_DAILY_ACTION_LIMIT = 25;
export const MAX_DAILY_ACTION_LIMIT = 50;
export const ACTIVE_HOURS_START = 8;
export const ACTIVE_HOURS_END = 21;
export const DEFAULT_COMPANION_TIME_ZONE = "America/Phoenix";

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function companionLocalHour(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_COMPANION_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value || "0");
}

export function isWithinCompanionActiveHours(now: Date, timeZone: string): boolean {
  const hour = companionLocalHour(now, timeZone);
  return hour >= ACTIVE_HOURS_START && hour < ACTIVE_HOURS_END;
}

export function hashCompanionSecret(value: string): string {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function createPairingCode(): string {
  return randomBytes(6).toString("hex").toUpperCase();
}

export function createDeviceToken(): string {
  return `cove_${randomBytes(32).toString("base64url")}`;
}

export function safeSecretEqual(left: string, right: string): boolean {
  const a = Buffer.from(hashCompanionSecret(left), "hex");
  const b = Buffer.from(hashCompanionSecret(right), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readBearerToken(header?: string): string {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ""));
  return match?.[1]?.trim() || "";
}
