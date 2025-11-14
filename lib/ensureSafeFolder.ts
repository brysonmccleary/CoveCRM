import mongoose from "mongoose";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

const FP = "ensureSafeFolder-v5"; // tracer fingerprint for logs

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

// Clean up noisy Google Sheets names like
// "Sheet Name — Sheet1 — 1763150405583" -> "Sheet Name"
function cleanGoogleName(raw: string): string {
  let name = String(raw || "").trim();
  if (!name) return name;

  // Strip "— SheetX" / "— Sheet1" / "— Sheet 1" chunks
  name = name.replace(/\s*—\s*Sheet[^—]*/i, "");

  // Strip trailing "— 1234567890..." (typical timestamp/id suffix)
  name = name.replace(/\s*—\s*\d{6,}\s*$/i, "");

  name = name.trim();
  return name || raw.trim();
}

export async function ensureSafeFolder(opts: Opts) {
  const {
    userEmail,
    folderId,
    folderName,
    defaultName,
    source = "google-sheets",
  } = opts;

  const isGoogle = source === "google-sheets";

  // ---------- 0) Normalize + optionally clean inputs ----------
  const byNameRaw = String(folderName ?? "").trim();
  const defBaseRaw = String(defaultName ?? "").trim() || "Imported Leads";

  const baseForName = isGoogle ? cleanGoogleName(byNameRaw) : byNameRaw;
  const baseForDefault = isGoogle ? cleanGoogleName(defBaseRaw) : defBaseRaw;

  const byName = baseForName;
  const defBase = baseForDefault || "Imported Leads";
  const defSafe = isSystemFolder(defBase) ? `${defBase} (Leads)` : defBase;

  // ---------- 1) If folderName provided, it wins (unless system) ----------
  if (byName) {
    const chosenName = isSystemFolder(byName) ? `${byName} (Leads)` : byName;
    let doc = await upsertFolderByName(userEmail, chosenName, source);

    // Final post-condition: never return a system folder
    if (!doc?.name || isSystemFolder(doc.name)) {
      const repaired = await upsertFolderByName(userEmail, defSafe, source);
      console.log(`[${FP}] clamp:name provided`, { userEmail, in: byName, out: repaired?.name });
      return repaired;
    }
    return doc;
  }

  // ---------- 2) If folderId provided, validate ownership + non-system ----------
  if (folderId && mongoose.isValidObjectId(folderId)) {
    const fid = new mongoose.Types.ObjectId(folderId);
    const found = await Folder.findOne({ _id: fid, userEmail });

    if (found && !isSystemFolder(found.name)) {
      // Double-check post-condition
      if (isSystemFolder(found.name)) {
        const repaired = await upsertFolderByName(userEmail, defSafe, source);
        console.log(`[${FP}] clamp:by id`, { userEmail, in: found?.name, out: repaired?.name });
        return repaired;
      }
      return found;
    }
    // system or not found → fall through to default
  }

  // ---------- 3) Default (never a system name) ----------
  let defDoc = await upsertFolderByName(userEmail, defSafe, source);

  // Final post-condition: absolutely never return a system folder
  if (!defDoc?.name || isSystemFolder(defDoc.name)) {
    const repaired = await upsertFolderByName(userEmail, `${defSafe} (Leads)`, source);
    console.log(`[${FP}] clamp:default`, { userEmail, in: defBase, out: repaired?.name });
    return repaired;
  }

  return defDoc;
}
