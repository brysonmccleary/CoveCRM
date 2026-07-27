export const FIRST_NAME_MESSAGE_TOKEN = "{{firstName}}";
export const MIN_DAILY_DM_LIMIT = 1;
export const MAX_DAILY_DM_LIMIT = 50;
export const DEFAULT_DAILY_DM_LIMIT = MAX_DAILY_DM_LIMIT;

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
