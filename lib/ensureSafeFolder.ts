import mongoose from "mongoose";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

type Opts = {
  userEmail: string;
  folderId?: string;
  folderName?: string;
  defaultName: string;   // required fallback (e.g., "<Drive Name> — <Tab Title>")
  source?: string;       // e.g. "google-sheets"
};

async function upsertFolderByName(userEmail: string, name: string, source: string) {
  return await Folder.findOneAndUpdate(
    { userEmail, name },
    { $setOnInsert: { userEmail, name, source } },
    { new: true, upsert: true }
  );
}

export async function ensureSafeFolder(opts: Opts) {
  const {
    userEmail,
    folderId,
    folderName,
    defaultName,
    source = "google-sheets",
  } = opts;

  // ---------- 0) Normalize inputs ----------
  const byName = String(folderName ?? "").trim();
  const defBase = String(defaultName ?? "").trim() || "Imported Leads";
  const defSafe = isSystemFolder(defBase) ? `${defBase} (Leads)` : defBase;

  // ---------- 1) If folderName provided, it wins (unless system) ----------
  if (byName) {
    const chosenName = isSystemFolder(byName) ? `${byName} (Leads)` : byName;
    const doc = await upsertFolderByName(userEmail, chosenName, source);

    // Final post-condition: never return a system folder
    if (isSystemFolder(doc?.name)) {
      const repaired = await upsertFolderByName(userEmail, defSafe, source);
      return repaired;
    }
    return doc;
  }

  // ---------- 2) If folderId provided, validate ownership + non-system ----------
  if (folderId && mongoose.isValidObjectId(folderId)) {
    const fid = new mongoose.Types.ObjectId(folderId);
    const found = await Folder.findOne({ _id: fid, userEmail });

    if (found && !isSystemFolder(found.name)) {
      // Final post-condition just in case
      if (isSystemFolder(found.name)) {
        const repaired = await upsertFolderByName(userEmail, defSafe, source);
        return repaired;
      }
      return found;
    }
    // system or not found → fall through to default
  }

  // ---------- 3) Default (never a system name) ----------
  const defDoc = await upsertFolderByName(userEmail, defSafe, source);

  // Final post-condition: absolutely never return a system folder
  if (isSystemFolder(defDoc?.name)) {
    const repaired = await upsertFolderByName(userEmail, `${defSafe} (Leads)`, source);
    return repaired;
  }

  return defDoc;
}
