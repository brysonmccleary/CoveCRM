import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { updateUserGoogleSheets } from "@/lib/userHelpers";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";

function parseStateEmail(state?: string | string[]) {
  if (!state) return "";
  try {
    const raw = Array.isArray(state) ? state[0] : state;
    const decoded = decodeURIComponent(raw);
    const json = JSON.parse(decoded);
    return (json?.email || "").toLowerCase();
  } catch {
    return "";
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const code = req.query.code as string | undefined;
    if (!code) return res.status(400).json({ error: "Missing authorization code" });

    // Try session first (happy path)
    const session = await getServerSession(req, res, authOptions);
    const sessionEmail =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";

    // Robust fallback: email passed in `state` from the /connect step
    const stateEmail = parseStateEmail(req.query.state);
    const email = sessionEmail || stateEmail;

    if (!email) {
      // As a last resort, send them to sign-in; don’t drop tokens on the floor
      return res.redirect("/auth/signin?reason=no_session_for_calendar_connect");
    }

    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "http://localhost:3000";

    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      `${base.replace(/\/$/, "")}/api/connect/google-calendar/callback`;

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri
    );

    // Exchange code for tokens
    const { tokens } = await oauth2.getToken(code);

    await dbConnect();

    // Get any existing tokens to keep as fallback if Google didn't send a new refresh_token
    const current = await User.findOne({ email }).lean<{
      googleTokens?: any;
      googleSheets?: any;
      googleCalendar?: any;
    }>();

    const fallbackRefresh =
      tokens.refresh_token ||
      current?.googleTokens?.refreshToken ||
      current?.googleSheets?.refreshToken ||
      current?.googleCalendar?.refreshToken ||
      "";

    // 1) Keep your legacy sheets helper (doesn't hurt, some parts may still read it)
    await updateUserGoogleSheets(email, {
      accessToken: tokens.access_token || "",
      refreshToken: fallbackRefresh,
      expiryDate: tokens.expiry_date ?? null,
    });

    // 2) Canonical: write to googleTokens (and also mirror googleCalendar for compatibility)
    await User.findOneAndUpdate(
      { email },
      {
        $set: {
          googleTokens: {
            accessToken: tokens.access_token || current?.googleTokens?.accessToken || "",
            refreshToken: fallbackRefresh,
            expiryDate: tokens.expiry_date ?? current?.googleTokens?.expiryDate ?? null,
          },
          googleCalendar: {
            accessToken: tokens.access_token || current?.googleCalendar?.accessToken || "",
            refreshToken: fallbackRefresh,
            expiryDate: tokens.expiry_date ?? current?.googleCalendar?.expiryDate ?? null,
          },
          // Optional: a simple success flag if you use it elsewhere
          flags: {
            ...(current as any)?.flags,
            calendarConnected: !!fallbackRefresh,
            calendarNeedsReconnect: !fallbackRefresh,
          },
        },
      },
      { new: false }
    );

    // Land them somewhere sensible
    return res.redirect("/dashboard?tab=settings");
  } catch (err: any) {
    console.error("Calendar OAuth callback error:", err?.response?.data || err?.message || err);
    return res.status(500).json({ error: "Calendar OAuth callback failed" });
  }
}
