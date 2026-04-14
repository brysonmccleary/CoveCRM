import { assertAccountActivated } from "@/lib/billing/requireActivatedAccount";

// lib/billing/assertBillingAllowed.ts
export function assertBillingAllowed(user: any): void {
  assertAccountActivated(user);
  if (Number(user?.usageBalance || 0) < -20) {
    throw new Error("Account paused due to unpaid usage balance.");
  }
}
