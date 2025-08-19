// /pages/api/google-auth/start.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthUrl } from "@/lib/googleOAuth";
import type { GoogleTarget } from "@/lib/googleOAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: "Google OAuth not configured." });
  }

  // ?target=calendar | sheets | both
  const target = (req.query.target as GoogleTarget) || "calendar";
  const url = getAuthUrl(target);

  // Redirect straight to Google instead of returning JSON
  return res.redirect(url);
}
