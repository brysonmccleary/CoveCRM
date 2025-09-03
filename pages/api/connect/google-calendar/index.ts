// pages/api/connect/google-calendar/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://localhost:3000";

  // IMPORTANT: matches your events.ts usage
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${base.replace(/\/$/, "")}/api/connect/google-calendar/callback`;

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );

  const scopes = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/calendar",
  ];

  const url = oauth2.generateAuthUrl({
    access_type: "offline",     // ensures refresh_token
    prompt: "consent",          // force consent so Google returns refresh_token
    include_granted_scopes: true,
    scope: scopes,
    redirect_uri: redirectUri,
    state: encodeURIComponent(JSON.stringify({ email })),
  });

  return res.redirect(url);
}
