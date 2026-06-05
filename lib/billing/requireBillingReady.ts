// lib/billing/requireBillingReady.ts
// Sync guard: checks Mongo fields only (trialGranted / hasEverPaid).
// Call this with a user document that includes: role, createdAt, billingMode,
// trialGranted, hasEverPaid, email, usedCode.

const ENFORCEMENT_STARTED_AT = new Date(
  process.env.ACCOUNT_ACTIVATION_ENFORCEMENT_STARTED_AT || "2026-04-10T00:00:00.000Z"
).getTime();

export type BillingReadyResult =
  | { ok: true }
  | { ok: false; reason: string; redirect: string };

export function requireBillingReady(user: any): BillingReadyResult {
  if (!user) return block("billing_pending", null);
  if (user.role === "admin") return { ok: true };

  // Legacy accounts (created before enforcement date) bypass the guard.
  const createdAt = user.createdAt ? new Date(user.createdAt).getTime() : 0;
  if (createdAt && createdAt < ENFORCEMENT_STARTED_AT) return { ok: true };

  // Self-billed users manage their own Twilio — no platform payment required.
  if (user.billingMode === "self") return { ok: true };

  // trialGranted is set only after a card is saved via grantTrialIfEligible.
  // hasEverPaid is set only after invoice.payment_succeeded webhook fires.
  if (user.trialGranted === true || user.hasEverPaid === true) return { ok: true };

  return block("billing_pending", user);
}

function block(reason: string, user: any): BillingReadyResult {
  const params = new URLSearchParams({ reason });
  const email = String(user?.email || "").trim();
  if (email) params.set("email", email);
  const usedCode = String(user?.usedCode || "").trim();
  if (usedCode) params.set("promoCode", usedCode);
  return { ok: false, reason, redirect: `/billing?${params.toString()}` };
}
