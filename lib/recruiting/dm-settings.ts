export const FIRST_NAME_MESSAGE_TOKEN = "{{firstName}}";
export const MIN_DAILY_DM_LIMIT = 1;
export const MAX_DAILY_DM_LIMIT = 50;
// Start every account at a conservative DM volume; customers can opt up to the
// max, but we never default a new account to the ceiling.
export const DEFAULT_DAILY_DM_LIMIT = 25;

// Warm-up ramp for freshly connected accounts: sudden full-volume DM activity
// on a new connection is the strongest platform-detection signal, so the first
// two weeks are capped regardless of the customer's configured limit.
export const DM_RAMP_WEEK_ONE_LIMIT = 10;
export const DM_RAMP_WEEK_TWO_LIMIT = 25;

export function effectiveDailyDmLimit(accountCreatedAt: Date | null | undefined, now: Date, configuredLimit: number): number {
  const limit = Number.isFinite(configuredLimit)
    ? Math.min(MAX_DAILY_DM_LIMIT, Math.max(MIN_DAILY_DM_LIMIT, Math.floor(configuredLimit)))
    : DEFAULT_DAILY_DM_LIMIT;
  const createdMs = accountCreatedAt instanceof Date ? accountCreatedAt.getTime() : NaN;
  // Unknown age fails closed to the week-one cap.
  const ageDays = Number.isFinite(createdMs) ? (now.getTime() - createdMs) / (24 * 60 * 60 * 1000) : 0;
  if (ageDays < 7) return Math.min(DM_RAMP_WEEK_ONE_LIMIT, limit);
  if (ageDays < 14) return Math.min(DM_RAMP_WEEK_TWO_LIMIT, limit);
  return limit;
}

// Ramped, hard daily ceilings for the non-DM actions. Likes are lowest-risk,
// follows and connections higher, so each gets its own conservative mature cap.
// Everything ramps over three weeks on a fresh account (25% / 50% / 75% / full),
// exactly like DMs, so a new connection never opens at full engagement volume.
export type RampableAction = "like_post" | "like_story" | "follow" | "connect";

export const MATURE_DAILY_ACTION_LIMITS: Record<RampableAction, number> = {
  like_post: 300,
  like_story: 150,
  follow: 100,
  connect: 20,
};

export function accountAgeDays(accountCreatedAt: Date | null | undefined, now: Date): number {
  const createdMs = accountCreatedAt instanceof Date ? accountCreatedAt.getTime() : NaN;
  return Number.isFinite(createdMs) ? (now.getTime() - createdMs) / (24 * 60 * 60 * 1000) : 0;
}

export function warmupFraction(ageDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays < 7) return 0.25;
  if (ageDays < 14) return 0.5;
  if (ageDays < 21) return 0.75;
  return 1;
}

// Returns the hard daily ceiling for one action type on one account, DM and
// non-DM alike, with the warm-up ramp applied. DMs keep their own stricter
// customer-configurable ramp; everything else uses the mature caps above.
export function effectiveDailyActionLimit(
  action: RampableAction | "dm",
  accountCreatedAt: Date | null | undefined,
  now: Date,
  configuredDmLimit: number,
): number {
  if (action === "dm") return effectiveDailyDmLimit(accountCreatedAt, now, configuredDmLimit);
  const fraction = warmupFraction(accountAgeDays(accountCreatedAt, now));
  return Math.max(1, Math.floor(MATURE_DAILY_ACTION_LIMITS[action] * fraction));
}

export function parseDailyDmLimit(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < MIN_DAILY_DM_LIMIT || parsed > MAX_DAILY_DM_LIMIT) {
    throw new Error(`Daily DM limit must be a whole number from ${MIN_DAILY_DM_LIMIT} to ${MAX_DAILY_DM_LIMIT}.`);
  }
  return parsed;
}

export function insertMessageToken(
  message: string,
  token: string,
  selectionStart: number,
  selectionEnd: number,
  maxLength = 500,
): { message: string; caret: number } {
  const start = Math.max(0, Math.min(message.length, selectionStart));
  const end = Math.max(start, Math.min(message.length, selectionEnd));
  const available = Math.max(0, maxLength - (message.length - (end - start)));
  const inserted = available >= token.length ? token : "";
  return {
    message: `${message.slice(0, start)}${inserted}${message.slice(end)}`,
    caret: start + inserted.length,
  };
}
