import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });

  if (!user?.googleRefreshToken) {
    return res.status(403).json({ error: "Google account not connected" });
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      `${process.env.NEXTAUTH_URL}/api/google/callback` // use same redirect used in auth.ts and callback.ts
    );

    oauth2Client.setCredentials({
      refresh_token: user.googleRefreshToken,
    });

    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet'",
      fields: "files(id, name)",
    });

    const sheets = response.data.files?.map(file => ({
      id: file.id,
      name: file.name,
    })) || [];

    return res.status(200).json({ sheets });
  } catch (error) {
    console.error("❌ Failed to list Google Sheets:", error);
    return res.status(500).json({ error: "Failed to retrieve sheets" });
  }
}
