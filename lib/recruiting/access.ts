import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";

export const RECRUITING_ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export function isRecruitingAdminEmail(email?: string | null): boolean {
  return isExperimentalAdminEmail(email) &&
    String(email || "").trim().toLowerCase() === RECRUITING_ADMIN_EMAIL;
}
