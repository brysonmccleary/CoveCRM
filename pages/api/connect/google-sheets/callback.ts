// /pages/api/connect/google-sheets/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

function getBaseUrl(req: NextApiRequest) {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    req.headers.host ||
    "localhost:3000";
  return `${proto}://${host}`.replace(/\/$/, "");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const stateEmail = req.query.state ? decodeURIComponent(String(req.query.state)) : "";
    const authedEmail = session?.user?.email || stateEmail;
    if (!authedEMailValid(authedEmail)) {
      return res.status(401).send("Unauthorized (no session and no state email)");
    }

    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      getBaseUrl(req);

    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI_SHEETS ||
      `${base}/api/connect/google-sheets/callback`;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri
    );

    const code = req.query.code as string;
    if (!code) return res.status(400).send("Missing ?code");

    // Exchange code → tokens
    const { tokens } = await oauth2Client.getToken(code);

    // (Optional) Fetch Google account email for display
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const me = await oauth2.userinfo.get();
    const googleEmail = me.data.email || "";

    await dbConnect();
    const user = await User.findOne({ email: authedEmail.toLowerCase() });
    if (!user) return res.status(404).send("User not found");

    // Persist under user.googleSheets; preserve existing refresh token if Google doesn’t send a new one
    user.googleSheets = {
      ...(user.googleSheets || {}),
      accessToken: tokens.access_token || "",
      refreshToken: tokens.refresh_token || user.googleSheets?.refreshToken || "",
      expiryDate:
        typeof tokens.expiry_date === "number"
          ? tokens.expiry_date
          : Date.now() + 45 * 60 * 1000,
      googleEmail: googleEmail || user.googleSheets?.googleEmail || "",
      sheets: user.googleSheets?.sheets || [],
    };

    await user.save();

    return res.redirect("/dashboard?tab=settings&sheet=connected");
  } catch (err: any) {
    console.error("[sheets/callback] error:", err?.response?.data || err);
    return res.status(500).send("Google Sheets OAuth callback failed");
  }
}

function authedEMailValid(email?: string | null): email is string {
  return !!email && typeof email === "string" && email.includes("@");
}
