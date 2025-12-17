// /pages/api/google/index.ts
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Generates the Google OAuth consent URL with the right scopes
 * and settings so we ALWAYS receive a refresh_token.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

  // Use env first; otherwise default to the exact scopes we need (match Cloud Console)
  const scopes =
    (process.env.GOOGLE_SCOPES || "").split(/\s+/).filter(Boolean).join(" ") ||
    [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "openid",
    ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline", // <-- ensures refresh_token (with prompt=consent)
    prompt: "consent", // <-- forces the consent screen so refresh_token is returned
    include_granted_scopes: "true",
  });

  res.writeHead(302, {
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
  res.end();
}
