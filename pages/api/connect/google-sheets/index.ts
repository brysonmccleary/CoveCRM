// /pages/api/connect/google-sheets/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { google } from "googleapis";

const SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";

  if (!email) {
    return res.redirect("/auth/signin?reason=google_sheets_connect");
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({
      error: "Missing Google OAuth env vars",
      have: {
        clientId: !!GOOGLE_CLIENT_ID,
        clientSecret: !!GOOGLE_CLIENT_SECRET,
      },
      need: {
        GOOGLE_CLIENT_ID: "(set to your Web client ID)",
        GOOGLE_CLIENT_SECRET: "(set to your Web client secret)",
      },
    });
  }

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    `http://${req.headers["x-forwarded-host"] || req.headers.host}`;

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI_SHEETS ||
    `${String(base).replace(/\/$/, "")}/api/connect/google-sheets/callback`;

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    redirectUri,
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SHEETS_SCOPES,
  });

  return res.redirect(authUrl);
}
