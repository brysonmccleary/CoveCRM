// /pages/api/google-auth/start.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://localhost:3000";

  const redirectUri = `${base.replace(/\/$/, "")}/api/google-auth/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );

  // IMPORTANT:
  // Request the full set so the consent screen is comprehensive and matches Cloud Console.
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      // Identity
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "openid",
      // Calendar (full access so consent wording matches)
      "https://www.googleapis.com/auth/calendar",
      // ✅ per-file Drive access used with Sheets API
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      // Sheets read-only
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  });

  return res.redirect(url);
}
