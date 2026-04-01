// lib/isExperimentalAdmin.ts
// Single source of truth for experimental / admin-only feature access.
// Update EXPERIMENTAL_ADMIN_EMAIL here to grant access to a different account.

const EXPERIMENTAL_ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

/** Returns true if the provided email belongs to the experimental admin. */
export function isExperimentalAdminEmail(email?: string | null): boolean {
  if (typeof email !== "string" || !email) return false;
  return email.toLowerCase().trim() === EXPERIMENTAL_ADMIN_EMAIL;
}
