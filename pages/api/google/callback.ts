// pages/api/google/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

function getOrigin(req: NextApiRequest): string {
  const xfProto = (req.headers["x-forwarded-proto"] as string) || "https";
  const xfHost =
    (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  if (xfHost) return `${xfProto}://${xfHost}`;
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  return base.replace(/\/$/, "");
}

function decodeEmailFromIdToken(idToken?: string): string | null {
  try {
    if (!idToken) return null;
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1] || "", "base64").toString("utf8"),
    );
    const email = String(payload?.email || "").toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

function decodeState(state?: string): { userEmail?: string } | null {
  try {
    if (!state) return null;
    const json = Buffer.from(state, "base64url").toString("utf8");
    const obj = JSON.parse(json);
    if (obj && typeof obj.userEmail === "string")
      return { userEmail: obj.userEmail.toLowerCase() };
    return null;
  } catch {
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  const code = String(req.query.code || "");
  if (!code) return res.status(400).send("Missing ?code");

  const origin = getOrigin(req);
  const redirectUri = `${origin}/api/google/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri, // must match the URI used to generate the auth URL
  );

  try {
    // 1) Exchange code -> tokens
    const { tokens } = await oauth2Client.getToken(code);
    const {
      access_token,
      refresh_token,
      expiry_date,
      id_token,
      scope,
      token_type,
    } = tokens;

    if (!refresh_token) {
      // Without a refresh_token we can’t do long-term automation.
      const base = origin;
      return res.redirect(`${base}/settings?calendar=needs_reconnect`);
    }

    oauth2Client.setCredentials({ access_token, refresh_token });

    // 2) Determine which CRM user to attach to:
    //    Prefer state.userEmail (from /api/google/auth), else fallback to Google account email.
    let targetEmail =
      decodeState(String(req.query.state || ""))?.userEmail || "";

    // Resolve Google account email (userinfo first; fallback to id_token)
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    let googleEmail = "";
    try {
      const me = await oauth2.userinfo.get();
      googleEmail = String(me.data.email || "").toLowerCase();
    } catch {
      googleEmail = decodeEmailFromIdToken(id_token) || "";
    }

    // If no state, use google email as the CRM key
    if (!targetEmail) targetEmail = googleEmail;

    if (!targetEmail)
      return res.status(400).send("Could not resolve account email");

    // 3) Connect DB and find the CRM user
    await mongooseConnect();
    const user = await User.findOne({ email: targetEmail });
    if (!user) {
      // If state email wasn't found, but googleEmail differs and exists, try fallback:
      if (googleEmail && googleEmail !== targetEmail) {
        const fallbackUser = await User.findOne({ email: googleEmail });
        if (!fallbackUser) {
          const base = origin;
          return res
            .status(404)
            .send(
              `No CRM user found for ${targetEmail} or ${googleEmail}. Make sure your CRM email matches, or start auth from your signed-in session.`,
            );
        }
        // attach to fallback user
        (fallbackUser as any).googleTokens = {
          ...(fallbackUser as any).googleTokens,
          accessToken: access_token || "",
          refreshToken: refresh_token,
          expiryDate: expiry_date || 0,
          scope: scope || "",
          tokenType: token_type || "",
          googleEmail,
        };

        // Calendar metadata (primary id)
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        let primaryCalendarId = "primary";
        try {
          const list = await calendar.calendarList.list();
          primaryCalendarId =
            list.data.items?.find((c: any) => c.primary)?.id || "primary";
        } catch {
          /* ignore */
        }

        (fallbackUser as any).googleCalendar = {
          ...(fallbackUser as any).googleCalendar,
          refreshToken: refresh_token,
          accessToken: access_token || "",
          expiryDate: expiry_date || 0,
          googleEmail,
          calendarId: primaryCalendarId,
        };
        // Keep backward-compat path some code reads:
        (fallbackUser as any).integrations = {
          ...(fallbackUser as any).integrations,
          googleCalendar: {
            refreshToken: refresh_token,
            accessToken: access_token || "",
            expiryDate: expiry_date || 0,
            calendarId: primaryCalendarId,
          },
        };
        (fallbackUser as any).flags = {
          ...(fallbackUser as any).flags,
          calendarConnected: true,
          calendarNeedsReconnect: false,
        };

        await fallbackUser.save();
        const base = origin;
        return res.redirect(`${base}/settings?calendar=connected`);
      }

      // no user at all
      return res
        .status(404)
        .send(
          `No CRM user found with email ${targetEmail}. Use the same email in CRM and Google.`,
        );
    }

    // 4) Get primary calendar id (fallback to "primary")
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    let primaryCalendarId = "primary";
    try {
      const list = await calendar.calendarList.list();
      primaryCalendarId =
        list.data.items?.find((c: any) => c.primary)?.id || "primary";
    } catch {
      /* ignore; default "primary" */
    }

    // 5) Persist tokens + calendar metadata (compat with multiple code paths)
    (user as any).googleTokens = {
      ...(user as any).googleTokens,
      accessToken: access_token || "",
      refreshToken: refresh_token,
      expiryDate: expiry_date || 0,
      scope: scope || "",
      tokenType: token_type || "",
      googleEmail: googleEmail || targetEmail,
    };

    (user as any).googleSheets = {
      ...(user as any).googleSheets,
      googleEmail: googleEmail || targetEmail,
    };

    (user as any).googleCalendar = {
      ...(user as any).googleCalendar,
      refreshToken: refresh_token,
      accessToken: access_token || "",
      expiryDate: expiry_date || 0,
      googleEmail: googleEmail || targetEmail,
      calendarId: primaryCalendarId,
    };

    // Back-compat alternative path used elsewhere
    (user as any).integrations = {
      ...(user as any).integrations,
      googleCalendar: {
        refreshToken: refresh_token,
        accessToken: access_token || "",
        expiryDate: expiry_date || 0,
        calendarId: primaryCalendarId,
      },
    };

    (user as any).flags = {
      ...(user as any).flags,
      calendarConnected: true,
      calendarNeedsReconnect: false,
    };

    await user.save();

    // 6) Redirect back to Settings with success
    const base = origin;
    return res.redirect(`${base}/settings?calendar=connected`);
  } catch (err: any) {
    console.error(
      "❌ Google OAuth callback error:",
      err?.response?.data || err?.message || err,
    );
    const base = origin;
    return res.redirect(`${base}/settings?calendar=error`);
  }
}
