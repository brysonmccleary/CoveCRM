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
  const hdr = req.headers["x-admin-secret"];
  const provided = Array.isArray(hdr) ? hdr[0] : hdr;
  if (provided !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await dbConnect();

  const out: any[] = [];
  const users = await User.find({ "googleSheets.syncedSheets.0": { $exists: true } })
    .select({ email: 1, googleSheets: 1 })
    .lean();

  for (const u of users) {
    const email = String((u as any).email || "").toLowerCase();
    const sheets = ((u as any)?.googleSheets?.syncedSheets || []) as any[];

    for (const s of sheets) {
      let folderName: string | null = s.folderName || null;

      // Only try to resolve folder by ID if it's a valid ObjectId
      const fidRaw = s.folderId ? String(s.folderId) : "";
      if (fidRaw && mongoose.Types.ObjectId.isValid(fidRaw)) {
        const fid = new mongoose.Types.ObjectId(fidRaw);
        const f = await Folder.findOne({ _id: fid, userEmail: email })
          .select({ name: 1 }) // only what we use
          .lean<{ _id: any; name?: string } | null>(); // TS-safe lean type

        if (f?.name) folderName = f.name;
      }

      const bad = folderName ? isSystemFolder(folderName) : false;

      out.push({
        email,
        spreadsheetId: s.spreadsheetId || null,
        title: s.title || null,
        folderId: fidRaw || null,
        folderName,
        isSystem: !!bad,
      });
    }
  }

  return res.status(200).json({ ok: true, entries: out.filter((e) => e.isSystem) });
}
