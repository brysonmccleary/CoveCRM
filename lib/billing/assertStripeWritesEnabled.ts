// lib/billing/assertStripeWritesEnabled.ts
// Single kill switch for all app-initiated Stripe write operations.
// Set DISABLE_ALL_STRIPE_BILLING=1 in Vercel env to block all charges immediately.
export function assertStripeWritesEnabled(): void {
  if (process.env.DISABLE_ALL_STRIPE_BILLING === "1") {
    console.error("[STRIPE WRITE BLOCKED] DISABLE_ALL_STRIPE_BILLING=1");
    throw new Error("Stripe writes are globally disabled (DISABLE_ALL_STRIPE_BILLING=1)");
  }
}
