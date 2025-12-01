// /pages/api/connect/google-sheets/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // 1) Make sure we have a code from Google
  const code = typeof req.query.code === "string" ? req.query.code : null;
  if (!code) {
    res.status(400).send("Missing ?code from Google OAuth callback");
    return;
  }

  // 2) Figure out which user this is (state from auth URL or session)
  const session = await getServerSession(req, res, authOptions);
  const emailFromState =
    typeof req.query.state === "string"
      ? decodeURIComponent(req.query.state)
      : undefined;

  const userEmail =
    (emailFromState || session?.user?.email || "").toLowerCase();

  if (!userEmail) {
    res.status(401).send("Could not resolve user for Google Sheets connect");
    return;
  }

  // 3) Prepare OAuth client with same redirect URI as /api/connect/google-sheets
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    getBaseUrl(req);

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI_SHEETS ||
    `${base}/api/connect/google-sheets/callback`;

  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).json({
      error: "Missing Google env in callback",
      have: {
        clientId: !!clientId,
        clientSecret: !!clientSecret,
        redirectUri: redirectUri || null,
      },
    });
    return;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  try {
    // 4) Exchange code for tokens
    const { tokens } = await oauth2.getToken(code);

    // 5) Persist tokens on the user document
    await mongooseConnect();

    await User.updateOne(
      { email: userEmail },
      {
        $set: {
          googleSheets: {
            accessToken: tokens.access_token || null,
            refreshToken: tokens.refresh_token || null,
            expiryDate: tokens.expiry_date || null,
            scope: tokens.scope || null,
            tokenType: tokens.token_type || null,
            idToken: tokens.id_token || null,
            connectedAt: new Date(),
          },
        },
      },
      { upsert: false }
    );

    // 6) Redirect back to the Google Sheets Sync page with the flag your UI looks for
    res.redirect("/google-sheets-sync?connected=google-sheets");
  } catch (err: any) {
    console.error("Google Sheets callback error:", err?.message || err);
    res
      .status(500)
      .send(
        `Google Sheets callback failed: ${
          err?.response?.data?.error || err?.message || "Unknown error"
        }`
      );
  }
}
