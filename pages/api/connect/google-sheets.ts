// /pages/api/connect/google-sheets.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const redirectUri = process.env.GOOGLE_REDIRECT_URI_SHEETS;
  if (!redirectUri) {
    return res.status(500).json({
      error: "Missing GOOGLE_REDIRECT_URI_SHEETS",
      hint: "Set it in Vercel to https://www.covecrm.com/api/connect/google-sheets/callback (and add this exact URI in Google Cloud > OAuth Client).",
    });
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });

  // Debug mode: shows the exact URL we will redirect to
  if (req.query.debug === "1") {
    return res.status(200).json({ redirectUri, authorizeUrl: url });
  }

  return res.redirect(url);
}
