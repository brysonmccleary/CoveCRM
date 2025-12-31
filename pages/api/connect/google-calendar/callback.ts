// /pages/api/connect/google-calendar/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const code = req.query.code as string | undefined;
    if (!code) {
      console.error("Calendar OAuth callback error: missing code");
      return res.status(400).send("Missing authorization code");
    }

    // Require logged-in user
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string"
        ? session.user.email.toLowerCase()
        : "";

    if (!email) {
      return res.redirect("/auth/signin?reason=no_session_for_calendar_connect");
    }

    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "http://localhost:3000";

    // 🔒 Must exactly match the redirectUri used in the connect route above.
    const redirectUri = `${base.replace(/\/$/, "")}/api/connect/google-calendar/callback`;

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri,
    );

    // Exchange code for tokens
    const { tokens } = await oauth2.getToken(code);

    await dbConnect();

    const current = await User.findOne({ email }).lean<{
      googleTokens?: any;
      googleCalendar?: any;
      flags?: any;
      integrations?: any;
    }>();

    if (!current) {
      console.error("Calendar OAuth callback error: user not found", email);
      return res.redirect("/auth/signin?reason=user_not_found_for_calendar");
    }

    // Prefer new refresh_token, fall back to any existing one if Google omits it
    // (Google may omit refresh_token if user previously consented and prompt isn't "consent",
    // but we DO use prompt=consent; this is still a safe fallback.)
    const refreshToken =
      tokens.refresh_token ||
      current?.googleCalendar?.refreshToken ||
      current?.googleTokens?.refreshToken ||
      "";

    const accessToken =
      tokens.access_token ||
      current?.googleCalendar?.accessToken ||
      current?.googleTokens?.accessToken ||
      "";

    const expiryDate =
      tokens.expiry_date ??
      current?.googleCalendar?.expiryDate ??
      current?.googleTokens?.expiryDate ??
      null;

    // Optional: store primary calendar id (best-effort)
    let primaryCalendarId = current?.googleCalendar?.calendarId || "primary";
    try {
      oauth2.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
      const calendar = google.calendar({ version: "v3", auth: oauth2 });
      const list = await calendar.calendarList.list();
      primaryCalendarId =
        list.data.items?.find((c: any) => c.primary)?.id || primaryCalendarId || "primary";
    } catch {
      /* ignore */
    }

    // Canonical storage: googleTokens + googleCalendar
    await User.findOneAndUpdate(
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
            ...(current as any)?.integrations,
            googleCalendar: {
              accessToken,
              refreshToken,
              expiryDate,
              calendarId: primaryCalendarId,
            },
          },
          flags: {
            ...(current as any)?.flags,
            calendarConnected: !!refreshToken,
            calendarNeedsReconnect: !refreshToken,
          },
        },
      },
      { new: false },
    );

    // ✅ Send them back to the Calendar tab
    const dashboardUrl = `${base.replace(/\/$/, "")}/dashboard?tab=calendar`;
    return res.redirect(dashboardUrl);
  } catch (err: any) {
    console.error(
      "Calendar OAuth callback error:",
      err?.response?.data || err?.message || err,
    );
    return res.status(500).send("Calendar OAuth callback failed");
  }
}
