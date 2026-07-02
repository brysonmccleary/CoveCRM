export const AFFILIATE_MONTHLY_CREDIT_CENTS = 1500;
export const AFFILIATE_MONTHLY_CREDIT_USD =
  AFFILIATE_MONTHLY_CREDIT_CENTS / 100;
export const AFFILIATE_CREDIT_HOLD_DAYS = 30;

export function affiliateCreditPayableAt(earnedAt = new Date()) {
  return new Date(
    earnedAt.getTime() + AFFILIATE_CREDIT_HOLD_DAYS * 24 * 60 * 60 * 1000,
  );
}
