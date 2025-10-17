import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import mongoose from "mongoose";
import User from "@/models/User";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

type SyncedEntry = {
  spreadsheetId?: string;
  title?: string;             // tab title
  sheetId?: number;
  folderId?: string;
  folderName?: string;
  fileName?: string;          // sometimes stored
  spreadsheetName?: string;   // sometimes stored
  sheetName?: string;         // sometimes stored
};

type UserDoc = {
  _id: any;
  email: string;
  googleSheets?: {
    syncedSheets?: SyncedEntry[];
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Optional: protect the endpoint
  // if (req.headers["x-admin-secret"] !== process.env.ADMIN_SECRET) {
  //   return res.status(403).json({ error: "Forbidden" });
  // }

  await dbConnect();

  const users = (await User.find(
    { "googleSheets.syncedSheets.0": { $exists: true } }
  )
    .select({ email: 1, googleSheets: 1 })
    .lean<UserDoc[]>()) || [];

  let repairedUsers = 0;
  let repairedEntries = 0;

  for (const u of users) {
    const arr = (u?.googleSheets?.syncedSheets || []) as SyncedEntry[];
    if (!arr.length) continue;

    let changed = false;

    for (const entry of arr) {
      const name = String(entry?.folderName || "").trim();
      const idStr = String(entry?.folderId || "").trim();

      let isBad = false;

      // Bad if the stored folderName is a system folder
      if (name && isSystemFolder(name)) {
        isBad = true;
      }

      // Or if the stored folderId points to a system folder
      if (!isBad && idStr && mongoose.isValidObjectId(idStr)) {
        const f = await Folder.findOne({
          _id: new mongoose.Types.ObjectId(idStr),
          userEmail: u.email,
        })
          .select({ name: 1 })
          .lean<{ _id: any; name?: string } | null>();

        if (f?.name && isSystemFolder(f.name)) {
          isBad = true;
        }
      }

      if (isBad) {
        // Build a safe, deterministic folder name
        const spreadsheetName =
          String(entry?.fileName || entry?.spreadsheetName || "Imported Leads").trim();
        const tabTitle = String(entry?.title || entry?.sheetName || "Sheet").trim();

        // Always suffix “(Leads)” to avoid collisions with system names
        const repairedName = `${spreadsheetName} — ${tabTitle} (Leads)`;

        // Upsert a safe folder for this user
        const repaired = await Folder.findOneAndUpdate(
          { userEmail: u.email, name: repairedName },
          { $setOnInsert: { userEmail: u.email, name: repairedName, source: "google-sheets" } },
          { new: true, upsert: true }
        ).lean<{ _id: any; name: string }>();

        entry.folderId = repaired?._id?.toString?.() || String(repaired?._id || "");
        entry.folderName = repaired?.name || repairedName;

        repairedEntries++;
        changed = true;
      }
    }

    if (changed) {
      await User.updateOne(
        { _id: u._id },
        { $set: { "googleSheets.syncedSheets": arr } }
      );
      repairedUsers++;
    }
  }

  return res.status(200).json({ ok: true, repairedUsers, repairedEntries });
}
