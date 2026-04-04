// lib/billing/assertBillingAllowed.ts
export function assertBillingAllowed(user: any): void {
  if (Number(user?.usageBalance || 0) < -20) {
    throw new Error("Account paused due to unpaid usage balance.");
  }
}
