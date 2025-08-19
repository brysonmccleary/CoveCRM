import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";

function getBaseUrl(req: NextApiRequest) {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.VERCEL ? "https" : "http");
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  if (proto && host) return `${proto}://${host}`;
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://localhost:3000"
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const base = getBaseUrl(req);
  const redirectUri = `${base}/api/connect/google-sheets/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });

  // Debug view without redirect
  if (req.query.debug) {
    res.status(200).json({ base, redirectUri, authorizedUrl: url });
    return;
  }

  // Be explicit: set the header and end the response
  res.setHeader("Location", url);
  // 302 (or 307) are fine; 302 is widely accepted by Google OAuth
  res.status(302).end();
}
