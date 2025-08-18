import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { updateUserGoogleSheets } from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const session = await getServerSession(req, res, authOptions);

    if (!session || !session.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const code = req.query.code as string;
    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_REDIRECT_URI!, // Should match /api/google/callback
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const profile = await oauth2.userinfo.get();

    // Save to user DB record
    await updateUserGoogleSheets(session.user.email, {
      accessToken: tokens.access_token || "",
      refreshToken: tokens.refresh_token || "",
      expiryDate: tokens.expiry_date || 0,
      googleEmail: profile.data.email || "",
    });

    // Redirect to sheet selection
    return res.redirect("/google-sheets-sync");
  } catch (err: any) {
    console.error("Google OAuth error:", err?.response?.data || err);
    return res.status(500).json({ error: "Google OAuth callback failed" });
  }
}
