// /lib/billing/trackAiDialerUsage.ts
// Legacy per-call AI dialer billing. No active callers remain.
// Throws on any call to prevent accidental re-wiring from producing charges.

export async function trackAiDialerUsage(_params: {
  user: any;
  minutes: number;
  vendorCostUsd: number;
}): Promise<void> {
  throw new Error(
    "trackAiDialerUsage is permanently disabled. Use trackAiDialerSessionUsage for AI Voice billing.",
  );
}
