// /pages/api/admin/audit-sheets.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";
import mongoose from "mongoose";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  // simple shared-secret guard
  if (req.headers["x-admin-secret"] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  await dbConnect();

  const out: any[] = [];
  const users = await User.find({ "googleSheets.syncedSheets.0": { $exists: true } })
    .select({ email: 1, googleSheets: 1 })
    .lean();

  for (const u of users) {
    const email = String((u as any).email || "").toLowerCase();
    const sheets = (u as any)?.googleSheets?.syncedSheets || [];
    for (const s of sheets) {
      const fid = s.folderId ? new mongoose.Types.ObjectId(String(s.folderId)) : null;
      let folderName: string | null = s.folderName || null;

      if (fid) {
        const f = await Folder.findOne({ _id: fid, userEmail: email }).lean();
        folderName = f?.name || folderName;
      }
      const bad = folderName ? isSystemFolder(folderName) : false;
      out.push({
        email,
        spreadsheetId: s.spreadsheetId,
        title: s.title,
        folderId: s.folderId || null,
        folderName: folderName,
        isSystem: !!bad,
      });
    }
  }

  res.status(200).json({ ok: true, entries: out.filter(e => e.isSystem) });
}
