import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { updateUserGoogleSheets } from "@/lib/userHelpers";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const code = req.query.code as string | undefined;
    if (!code) {
      console.error("Calendar OAuth callback error: missing code");
      return res.status(400).send("Missing authorization code");
    }

    // 1) Require a logged-in user; no fancy state logic needed.
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string"
        ? session.user.email.toLowerCase()
        : "";

    if (!email) {
      // As a last resort, send them to sign-in; don’t drop tokens on the floor
      return res.redirect(
        "/auth/signin?reason=no_session_for_calendar_connect"
      );
    }

    // 2) Use the SAME redirect URI as the /api/connect/google-calendar start route.
    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "http://localhost:3000";

    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI_CALENDAR ||
      `${base.replace(/\/$/, "")}/api/connect/google-calendar/callback`;

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri
    );

    // 3) Exchange code for tokens
    const { tokens } = await oauth2.getToken(code);

    await dbConnect();

    // Get any existing tokens so we can preserve accessToken/expiry if Google omits them
    const current = await User.findOne({ email }).lean<{
      googleTokens?: any;
      googleSheets?: any;
      googleCalendar?: any;
      flags?: any;
    }>();

    if (!current) {
      console.error("Calendar OAuth callback error: user not found", email);
      return res.redirect("/auth/signin?reason=user_not_found_for_calendar");
    }

    // Prefer a brand-new refresh_token; fall back to any existing calendar/token refresh.
    const refreshToken =
      tokens.refresh_token ||
      current?.googleCalendar?.refreshToken ||
      current?.googleTokens?.refreshToken ||
      current?.googleSheets?.refreshToken ||
      "";

    // 4) Keep your legacy Sheets helper (some parts may still rely on it)
    await updateUserGoogleSheets(email, {
      accessToken:
        tokens.access_token ||
        current?.googleSheets?.accessToken ||
        current?.googleTokens?.accessToken ||
        "",
      refreshToken,
      expiryDate:
        tokens.expiry_date ??
        current?.googleSheets?.expiryDate ??
        current?.googleTokens?.expiryDate ??
        null,
    });

    // 5) Canonical storage: googleTokens + googleCalendar
    await User.findOneAndUpdate(
      { email },
      {
        $set: {
          googleTokens: {
            accessToken:
              tokens.access_token ||
              current?.googleTokens?.accessToken ||
              "",
            refreshToken,
            expiryDate:
              tokens.expiry_date ??
              current?.googleTokens?.expiryDate ??
              null,
          },
          googleCalendar: {
            accessToken:
              tokens.access_token ||
              current?.googleCalendar?.accessToken ||
              current?.googleTokens?.accessToken ||
              "",
            refreshToken,
            expiryDate:
              tokens.expiry_date ??
              current?.googleCalendar?.expiryDate ??
              current?.googleTokens?.expiryDate ??
              null,
          },
          flags: {
            ...(current as any)?.flags,
            calendarConnected: !!refreshToken,
            calendarNeedsReconnect: !refreshToken,
          },
        },
      },
      { new: false }
    );

    // 6) Land them somewhere sensible (your Settings/Calendar tab)
    return res.redirect("/dashboard?tab=settings");
  } catch (err: any) {
    console.error(
      "Calendar OAuth callback error:",
      err?.response?.data || err?.message || err
    );
    return res.status(500).send("Calendar OAuth callback failed");
  }
}
