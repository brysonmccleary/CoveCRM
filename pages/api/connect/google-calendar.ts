// /pages/api/connect/google-calendar.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";

/**
 * Compat endpoint used by your “Connect Google Calendar” button.
 * It simply redirects into the unified start endpoint with target=calendar.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Kick off OAuth — the callback is /api/google-auth/callback
  return res.redirect(302, "/api/google-auth/start?target=calendar");
}
