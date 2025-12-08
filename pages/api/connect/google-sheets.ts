// /pages/api/connect/google-sheets.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { google } from "googleapis";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI_SHEETS;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).json({
      error: "Missing env",
      have: {
        clientId: !!clientId,
        clientSecret: !!clientSecret,
        redirectUri: redirectUri || null,
      },
      need: {
        GOOGLE_CLIENT_ID: "(set to your Web client ID)",
        GOOGLE_CLIENT_SECRET: "(set to your Web client secret)",
        GOOGLE_REDIRECT_URI_SHEETS:
          "https://www.covecrm.com/api/connect/google-sheets/callback",
      },
    });
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const scope = [
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "openid",
  ];

  const authorizeUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope,
  });

  if (typeof req.query.debug !== "undefined") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      clientId,
      redirectUri,
      scope,
      authorizeUrl,
    });
  }

  res.redirect(authorizeUrl);
}
