import mongoose from "mongoose";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

export async function ensureSafeFolder(opts: {
  userEmail: string;
  folderId?: string;
  folderName?: string;
  defaultName: string;         // required fallback
  source?: string;             // e.g. "google-sheets"
}) {
  const { userEmail, folderId, folderName, defaultName, source = "google-sheets" } = opts;

  // 1) If folderName provided, it wins (unless system)
  const byName = (folderName || "").trim();
  if (byName) {
    if (isSystemFolder(byName)) {
      const safe = `${byName} (Leads)`;
      return await Folder.findOneAndUpdate(
        { userEmail, name: safe },
        { $setOnInsert: { userEmail, name: safe, source } },
        { new: true, upsert: true }
      );
    }
    return await Folder.findOneAndUpdate(
      { userEmail, name: byName },
      { $setOnInsert: { userEmail, name: byName, source } },
      { new: true, upsert: true }
    );
  }

  // 2) If folderId provided, validate ownership + non-system
  if (folderId) {
    const fid = new mongoose.Types.ObjectId(folderId);
    const doc = await Folder.findOne({ _id: fid, userEmail });
    if (doc && !isSystemFolder(doc.name)) return doc;
    // system or not found → fall through to default
  }

  // 3) Default name (never a system name)
  const def = (defaultName || "").trim() || "Imported Leads";
  const safeName = isSystemFolder(def) ? `${def} (Leads)` : def;
  return await Folder.findOneAndUpdate(
    { userEmail, name: safeName },
    { $setOnInsert: { userEmail, name: safeName, source } },
    { new: true, upsert: true }
  );
}
