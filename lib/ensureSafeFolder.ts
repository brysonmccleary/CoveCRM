import mongoose from "mongoose";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

const FP = "ensureSafeFolder-v4";

type Opts = {
  userEmail: string;
  folderId?: string;
  folderName?: string;
  defaultName: string;   // e.g., "<Drive Name> — <Tab Title>"
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

  const byName = String(folderName ?? "").trim();
  const defBase = String(defaultName ?? "").trim() || "Imported Leads";
  const defSafe = isSystemFolder(defBase) ? `${defBase} (Leads)` : defBase;

  // 1) Name provided → wins unless system; clamp if needed
  if (byName) {
    const chosenName = isSystemFolder(byName) ? `${byName} (Leads)` : byName;
    let doc = await upsertFolderByName(userEmail, chosenName, source);
    if (!doc?.name || isSystemFolder(doc.name)) {
      const repaired = await upsertFolderByName(userEmail, defSafe, source);
      console.log(`[${FP}] clamp:name provided`, { userEmail, in: byName, out: repaired?.name });
      return repaired;
    }
    return doc;
  }

  // 2) Id provided → validate ownership + non-system; else clamp to default
  if (folderId && mongoose.isValidObjectId(folderId)) {
    const fid = new mongoose.Types.ObjectId(folderId);
    const found = await Folder.findOne({ _id: fid, userEmail });
    if (found && !isSystemFolder(found.name)) {
      if (isSystemFolder(found.name)) {
        const repaired = await upsertFolderByName(userEmail, defSafe, source);
        console.log(`[${FP}] clamp:by id`, { userEmail, in: found?.name, out: repaired?.name });
        return repaired;
      }
      return found;
    }
  }

  // 3) Default (never a system name)
  let defDoc = await upsertFolderByName(userEmail, defSafe, source);
  if (!defDoc?.name || isSystemFolder(defDoc.name)) {
    const repaired = await upsertFolderByName(userEmail, `${defSafe} (Leads)`, source);
    console.log(`[${FP}] clamp:default`, { userEmail, in: defBase, out: repaired?.name });
    return repaired;
  }
  return defDoc;
}
