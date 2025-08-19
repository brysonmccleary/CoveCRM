// /pages/api/google-auth/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { getOAuthClient } from "@/lib/googleOAuth";
import { updateUserGoogleSheets } from "@/lib/userHelpers"; // your existing helper

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const code = req.query.code as string | undefined;
    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ error: "Google OAuth not configured." });
    }

    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    // Persist tokens to your user document
    await updateUserGoogleSheets(session.user.email, {
      accessToken: tokens.access_token || "",
      refreshToken: tokens.refresh_token || "",
      expiryDate: tokens.expiry_date ?? null,
    });

    // Done — back to settings
    return res.redirect("/dashboard?tab=settings");
  } catch (err: any) {
    const detail = err?.response?.data || err?.message || err;
    console.error("[google-auth/callback] error:", detail);
    return res.status(500).json({ error: "Google OAuth callback failed" });
  }
}
