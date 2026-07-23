import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isRecruitingAdminEmail } from "@/lib/recruiting/access";

export { isRecruitingAdminEmail, RECRUITING_ADMIN_EMAIL } from "@/lib/recruiting/access";

export async function requireRecruitingAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ email: string } | null> {
  const session = await getServerSession(req, res, authOptions);
  const email = String(session?.user?.email || "").trim().toLowerCase();
  if (!isRecruitingAdminEmail(email)) {
    res.status(email ? 403 : 401).json({ error: email ? "Forbidden" : "Unauthorized" });
    return null;
  }
  return { email };
}
