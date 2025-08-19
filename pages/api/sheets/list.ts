// /pages/api/sheets/list.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email.toLowerCase() }).lean();
  const gs = (user as any)?.googleSheets;
  if (!gs?.refreshToken) {
    return res.status(400).json({ error: "Google Sheets not connected" });
  }

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    `https://${req.headers["x-forwarded-host"] || req.headers.host}`;

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI_SHEETS ||
    `${base}/api/connect/google-sheets/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );

  oauth2Client.setCredentials({
    access_token: gs.accessToken || undefined,
    refresh_token: gs.refreshToken || undefined,
    expiry_date: gs.expiryDate || undefined,
  });

  const drive = google.drive({ version: "v3", auth: oauth2Client });

  try {
    // Only Google Sheets
    const q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
    const r = await drive.files.list({
      q,
      fields: "files(id,name,modifiedTime,owners(emailAddress))",
      pageSize: 100,
      orderBy: "modifiedTime desc",
    });

    return res.status(200).json({ files: r.data.files || [] });
  } catch (err: any) {
    const message = err?.errors?.[0]?.message || err?.message || "Drive list failed";
    return res.status(500).json({ error: message });
  }
}
