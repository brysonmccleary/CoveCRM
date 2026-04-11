export const ACCOUNT_NOT_ACTIVATED_MESSAGE = "Account not activated";

const ENFORCEMENT_STARTED_AT = new Date(
  process.env.ACCOUNT_ACTIVATION_ENFORCEMENT_STARTED_AT || "2026-04-10T00:00:00.000Z"
).getTime();

function isLegacyAccount(user: any): boolean {
  const createdAt = user?.createdAt ? new Date(user.createdAt).getTime() : 0;
  return Boolean(createdAt && createdAt < ENFORCEMENT_STARTED_AT);
}

export function isAccountActivated(user: any): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (isLegacyAccount(user)) return true;
  return user.emailVerified === true && user.trialGranted === true;
}

export function assertAccountActivated(user: any): void {
  if (!isAccountActivated(user)) {
    const err = new Error(ACCOUNT_NOT_ACTIVATED_MESSAGE) as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
}
