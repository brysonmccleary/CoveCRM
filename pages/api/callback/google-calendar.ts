// /pages/api/callback/google-calendar.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";
import { google } from "googleapis";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

// Optional: override the final redirect path without touching code
// e.g. CALENDAR_SUCCESS_PATH=/settings?calendar=connected
const CALENDAR_SUCCESS_PATH = process.env.CALENDAR_SUCCESS_PATH || "/";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  const { code, next } = req.query as { code?: string; next?: string };
  if (!code) return res.status(400).send("Missing ?code");

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  try {
    // 1) Exchange code -> tokens
    const { tokens } = await oauth2Client.getToken(code);
    const { refresh_token, access_token } = tokens;

    // 2) Identify which Google account authorized
    oauth2Client.setCredentials({ access_token, refresh_token: refresh_token || undefined });
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const me = await oauth2.userinfo.get();
    const googleEmail = String(me.data.email || "").toLowerCase();
    if (!googleEmail) return res.status(400).send("Could not read Google account email");

    // 3) Lookup CRM user
    await dbConnect();
    const user = await User.findOne({ email: googleEmail });
    if (!user) {
      return res
        .status(404)
        .send(`No CRM user found with email ${googleEmail}. Use the same email in CRM and Google.`);
    }

    // 4) Ensure we have a long-lived refresh token
    //    If Google didn't return one this time (common when user already granted),
    //    reuse the one we have on file. If neither exists, ask to reconnect with consent.
    const existingRT = (user as any)?.googleTokens?.refreshToken || "";
    const finalRefreshToken = refresh_token || existingRT;
    if (!finalRefreshToken) {
      return res
        .status(400)
        .send("No refresh_token available. Please reconnect with access_type=offline&prompt=consent.");
    }

    // 5) Save tokens + automation flags
    (user as any).googleTokens = (user as any).googleTokens || {};
    (user as any).googleTokens.refreshToken = finalRefreshToken;
    (user as any).googleTokens.accessToken = access_token || ""; // optional (diagnostics)

    if (!(user as any).calendarId) (user as any).calendarId = "primary";
    (user as any).flags = {
      ...(user as any).flags,
      calendarConnected: true,
      calendarNeedsReconnect: false,
    };

    await user.save();

    // 6) Safe redirect (prevent open redirects). Allow only relative paths.
    const base =
      (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000").replace(
        /\/$/,
        ""
      );
    const safeNext =
      typeof next === "string" && next.startsWith("/") ? next : CALENDAR_SUCCESS_PATH;
    const successUrl = `${base}${safeNext}`;

    return res.redirect(successUrl);
  } catch (err: any) {
    console.error("❌ OAuth callback error:", err?.response?.data || err?.message || err);
    return res.status(500).send("OAuth error. See server logs.");
  }
}
