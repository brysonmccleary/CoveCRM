// /pages/api/debug/sheets-sync-user.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = (Array.isArray(req.query.token) ? req.query.token[0] : req.query.token) as string | undefined;
  if (!token || token !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const email = (Array.isArray(req.query.email) ? req.query.email[0] : req.query.email)?.toLowerCase();
  if (!email) return res.status(400).json({ error: "Missing email" });

  try {
    await dbConnect();
    const u: any = await User.findOne({ email }).lean();

    if (!u) return res.status(404).json({ error: "User not found" });

    return res.status(200).json({
      email: u.email,
      hasGoogleSheets: !!u.googleSheets,
      keysInGoogleSheets: u.googleSheets ? Object.keys(u.googleSheets) : [],
      syncedSheetsCount: u.googleSheets?.syncedSheets?.length || 0,
      syncedSheets: (u.googleSheets?.syncedSheets || []).map((s: any) => ({
        spreadsheetId: s.spreadsheetId,
        title: s.title,
        sheetId: s.sheetId,
        headerRow: s.headerRow,
        lastRowImported: s.lastRowImported,
        folderName: s.folderName,
      })),
      hasLegacyGoogleTokens: !!u.googleTokens,
      legacyKeys: u.googleTokens ? Object.keys(u.googleTokens) : [],
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "debug failed" });
  }
}
