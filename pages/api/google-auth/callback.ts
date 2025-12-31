// /pages/api/google-auth/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const code = req.query.code as string;
    if (!code) return res.status(400).json({ error: "Missing authorization code" });

    const email = String(session.user.email).toLowerCase();

    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "http://localhost:3000";
    const redirectUri = `${base.replace(/\/$/, "")}/api/google-auth/callback`;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri,
    );

    const { tokens } = await oauth2Client.getToken(code);

    const refreshToken = tokens.refresh_token || "";
    const accessToken = tokens.access_token || "";
    const expiryDate = tokens.expiry_date ?? null;

    // Best-effort: primary calendar id
    let primaryCalendarId = "primary";
    try {
      oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      const list = await calendar.calendarList.list();
      primaryCalendarId =
        list.data.items?.find((c: any) => c.primary)?.id || "primary";
    } catch {
      /* ignore */
    }

    await dbConnect();
    await User.updateOne(
      { email },
      {
        $set: {
          googleTokens: {
            accessToken,
            refreshToken,
            expiryDate,
          },
          googleCalendar: {
            accessToken,
            refreshToken,
            expiryDate,
            calendarId: primaryCalendarId,
          },
          integrations: {
            googleCalendar: {
              accessToken,
              refreshToken,
              expiryDate,
              calendarId: primaryCalendarId,
            },
          },
          flags: {
            calendarConnected: !!refreshToken,
            calendarNeedsReconnect: !refreshToken,
          },
        },
      },
    );

    return res.redirect("/dashboard?tab=calendar");
  } catch (err: any) {
    console.error("Google OAuth callback error:", err?.response?.data || err);
    return res.status(500).json({ error: "Google OAuth callback failed" });
  }
}
