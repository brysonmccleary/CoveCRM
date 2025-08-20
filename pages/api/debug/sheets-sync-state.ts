// /pages/api/debug/sheets-sync-state.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // optional safety: require the same token you use for cron
  const token = (Array.isArray(req.query.token) ? req.query.token[0] : req.query.token) as string | undefined;
  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await dbConnect();
    const users = await User.find({ "googleSheets.syncedSheets.0": { $exists: true } })
      .select("email googleSheets.syncedSheets.spreadsheetId googleSheets.syncedSheets.title googleSheets.syncedSheets.lastRowImported")
      .lean();

    res.status(200).json({
      vercelEnv: process.env.VERCEL_ENV || "unknown",
      nodeEnv: process.env.NODE_ENV,
      dbUriHint: (process.env.MONGODB_URI || "").split("@").pop()?.split("?")[0], // mask most of the URI, just show host/db
      usersWithSyncedSheets: users.length,
      users: users.map((u: any) => ({
        email: u.email,
        syncedSheets: (u.googleSheets?.syncedSheets || []).map((s: any) => ({
          spreadsheetId: s.spreadsheetId,
          title: s.title,
          lastRowImported: s.lastRowImported,
        })),
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "debug failed" });
  }
}
