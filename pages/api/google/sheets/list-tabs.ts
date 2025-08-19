// /pages/api/google/sheets/list-tabs.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const spreadsheetId = String(req.query.spreadsheetId || "");
  if (!spreadsheetId) return res.status(400).json({ error: "Missing spreadsheetId" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email.toLowerCase() }).lean();
  const gs = (user as any)?.googleSheets;
  if (!gs?.refreshToken) return res.status(400).json({ error: "Google not connected" });

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!
  );
  oauth2.setCredentials({
    access_token: gs.accessToken,
    refresh_token: gs.refreshToken,
    expiry_date: gs.expiryDate,
  });

  const sheets = google.sheets({ version: "v4", auth: oauth2 });
  try {
    const { data } = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title,index))",
    });

    const tabs = (data.sheets || []).map((s) => ({
      sheetId: s.properties?.sheetId,
      title: s.properties?.title,
      index: s.properties?.index,
    }));

    return res.status(200).json({ tabs });
  } catch (err: any) {
    const message = err?.errors?.[0]?.message || err?.message || "Sheets get failed";
    return res.status(500).json({ error: message });
  }
}
