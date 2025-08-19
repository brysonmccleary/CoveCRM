// /pages/api/connect/google-sheets/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    getBaseUrl(req);

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI_SHEETS ||
    `${base}/api/connect/google-sheets/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    // Pass the signed-in user's email so callback can identify them even if the session cookie isn't present
    state: encodeURIComponent(session.user.email),
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });

  if (req.query.debug) {
    return res.status(200).json({
      url,
      redirectUri,
      base,
      state: session.user.email,
    });
  }

  return res.redirect(url);
}
