import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]"; // <-- fixed path
import { updateUserGoogleSheets } from "@/lib/userHelpers";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const code = req.query.code as string;
    if (!code) return res.status(400).json({ error: "Missing authorization code" });

    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "http://localhost:3000";

    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI_SHEETS ||
      `${base.replace(/\/$/, "")}/api/connect/google-sheets/callback`;

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri
    );

    const { tokens } = await oauth2.getToken(code);

    await updateUserGoogleSheets(session.user.email, {
      accessToken: tokens.access_token || "",
      refreshToken: tokens.refresh_token || "",
      expiryDate: tokens.expiry_date ?? null,
    });

    return res.redirect("/dashboard?tab=settings");
  } catch (err: any) {
    console.error("Sheets OAuth callback error:", err?.response?.data || err);
    return res.status(500).json({ error: "Sheets OAuth callback failed" });
  }
}
