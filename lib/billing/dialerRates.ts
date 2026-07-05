export const MANUAL_TALK_RATE_PER_MIN = 0.022;
export const AI_SESSION_RATE_PER_MIN = 0.01;
export const AI_TALK_RATE_PER_MIN = 0.08;

export function billableConnectedSeconds(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.ceil(durationSec / 60) * 60;
}

export function amountCentsForBillableSeconds(
  billableSeconds: number,
  ratePerMinute: number,
): number {
  if (!Number.isFinite(billableSeconds) || billableSeconds <= 0) return 0;
  if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) return 0;
  return Math.round((billableSeconds / 60) * ratePerMinute * 100);
}

export function amountDollarsForBillableSeconds(
  billableSeconds: number,
  ratePerMinute: number,
): number {
  return amountCentsForBillableSeconds(billableSeconds, ratePerMinute) / 100;
}
