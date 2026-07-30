import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";

export const RECRUITING_ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export function isRecruitingAdminEmail(email?: string | null): boolean {
  return isExperimentalAdminEmail(email) &&
    String(email || "").trim().toLowerCase() === RECRUITING_ADMIN_EMAIL;
}

// Worker-side entitlement check, enforced when claiming cloud accounts so a
// lapsed or revoked owner can never keep consuming automation. Today only the
// recruiting admin is entitled; when Stripe checkout ships, replace the body
// with a subscription lookup (active/trialing recruiting plan) — the worker
// call site does not need to change.
export async function ownerHasRecruitingEntitlement(email?: string | null): Promise<boolean> {
  return isRecruitingAdminEmail(email);
}
