// /pages/api/google/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import mongooseConnect from "@/lib/mongooseConnect"; // you use mongoose for everything
import User from "@/models/User";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

function decodeEmailFromIdToken(idToken?: string): string | null {
  try {
    if (!idToken) return null;
    const payload = JSON.parse(
      Buffer.from((idToken.split(".")[1] || ""), "base64").toString("utf8")
    );
    const email = String(payload?.email || "").toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  const code = String(req.query.code || "");
  if (!code) return res.status(400).send("Missing ?code");

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI // must match Google Console exactly
  );

  try {
    // 1) Exchange code -> tokens
    const { tokens } = await oauth2Client.getToken(code);
    const { access_token, refresh_token, expiry_date, id_token, scope, token_type } = tokens;

    if (!refresh_token) {
      // Without a refresh_token we can’t do long-term automation.
      // This happens if consent wasn’t forced; our /api/google page sets prompt=consent,
      // but if you still hit this, ask the user to reconnect.
      const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "";
      return res.redirect(`${base}/settings?calendar=needs_reconnect`);
    }

    oauth2Client.setCredentials({ access_token, refresh_token });

    // 2) Resolve Google account email (userinfo first; fallback to id_token)
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    let googleEmail = "";
    try {
      const me = await oauth2.userinfo.get();
      googleEmail = String(me.data.email || "").toLowerCase();
    } catch {
      googleEmail = decodeEmailFromIdToken(id_token) || "";
    }
    if (!googleEmail) return res.status(400).send("Could not read Google account email");

    // 3) Connect DB and find the CRM user by email (exact match)
    await mongooseConnect();
    const user = await User.findOne({ email: googleEmail });
    if (!user) {
      return res
        .status(404)
        .send(`No CRM user found with email ${googleEmail}. Use the same email in CRM and Google.`);
    }

    // 4) Get primary calendar id (fallback to "primary")
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    let primaryCalendarId = "primary";
    try {
      const list = await calendar.calendarList.list();
      primaryCalendarId =
        list.data.items?.find((c: any) => c.primary)?.id || "primary";
    } catch {
      // ignore; default "primary"
    }

    // 5) Persist tokens + calendar metadata
    (user as any).googleTokens = (user as any).googleTokens || {};
    (user as any).googleTokens.accessToken = access_token || "";
    (user as any).googleTokens.refreshToken = refresh_token; // critical for long-term usage
    (user as any).googleTokens.expiryDate = expiry_date || 0;
    (user as any).googleTokens.scope = scope || "";
    (user as any).googleTokens.tokenType = token_type || "";

    // Save the canonical Google email (handy in other parts of the app)
    (user as any).googleSheets = {
      ...(user as any).googleSheets,
      googleEmail,
    };

    // Calendar + automation flags
    (user as any).calendarId = primaryCalendarId;
    (user as any).flags = {
      ...(user as any).flags,
      calendarConnected: true,
      calendarNeedsReconnect: false,
    };

    await user.save();

    // 6) Redirect back to Settings with success
    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "";
    return res.redirect(`${base}/settings?calendar=connected`);
  } catch (err: any) {
    console.error("❌ Google OAuth callback error:", err?.response?.data || err?.message || err);
    return res.status(500).send("OAuth error. See server logs.");
  }
}
