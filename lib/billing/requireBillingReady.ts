// lib/billing/requireBillingReady.ts
// Sync guard: checks Mongo fields only (trialGranted / hasEverPaid / billingBlocked).
// Call this with a user document that includes: role, createdAt, billingMode,
// trialGranted, hasEverPaid, billingBlocked, email, usedCode.

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

  // billingBlocked is set by the repair script for users whose hasEverPaid was
  // poisoned by a $0 trial invoice without a real card on file. Distrust hasEverPaid
  // entirely for these users and force them back to billing.
  if (user.billingBlocked === true) return block("missing_payment_method", user);

  // cardOnFile: new signup flow sets this after a verified payment method is confirmed.
  if (user.cardOnFile === true) return { ok: true };

  // trialGranted: set only after a card is saved via grantTrialIfEligible (verified fingerprint).
  // hasEverPaid: set only after invoice.payment_succeeded with paidCents > 0 (fixed in webhook).
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
