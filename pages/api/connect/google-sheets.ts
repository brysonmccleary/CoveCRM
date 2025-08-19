// /pages/api/connect/google-sheets.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://localhost:3000";

  // ✅ Unified callback
  const redirectUri = `${base}/api/google-auth/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );

  // Sheets scopes (add Drive if you create/export files)
  const scopes = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/spreadsheets",
    // "https://www.googleapis.com/auth/drive.file", // optional if you create files
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state: session.user.email, // optional
  });

  return res.redirect(url);
}
