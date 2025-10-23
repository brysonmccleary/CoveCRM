// /lib/ensureSafeFolder.ts
import mongoose from "mongoose";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

const FP = "ensureSafeFolder-v5-sheetId-first";

type Opts = {
  userEmail: string;
  folderId?: string;
  folderName?: string;
  defaultName: string;     // e.g. "<Drive Name> — <Tab Title>"
  source?: string;         // e.g. "google-sheets"
  sheetId?: string;        // <- NEW: immutable spreadsheet ID for mapping
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
    sheetId,
  } = opts;

  const desiredName = String(folderName ?? "").trim();
  const baseDefault = String(defaultName ?? "").trim() || "Imported Leads";
  const safeDefault = isSystemFolder(baseDefault) ? `${baseDefault} (Leads)` : baseDefault;

  // ---------- A) If sheetId is provided, it ALWAYS wins ----------
  if (sheetId) {
    // 1) Try exact (userEmail, sheetId) first
    const bySheet = await Folder.findOne({ userEmail, sheetId });
    if (bySheet && bySheet.name && !isSystemFolder(bySheet.name)) {
      return bySheet;
    }

    // 2) If not found by sheetId, try to attach sheetId to an existing non-system folder:
    //    Prefer an explicit folderName, otherwise fall back to defaultName.
    const nameToUse = desiredName || safeDefault;
    const chosenName = isSystemFolder(nameToUse) ? `${nameToUse} (Leads)` : nameToUse;

    let target = await upsertFolderByName(userEmail, chosenName, source);

    // If the upsert somehow returned a system folder name, clamp to default safe name
    if (!target?.name || isSystemFolder(target.name)) {
      const repaired = await upsertFolderByName(userEmail, safeDefault, source);
      target = repaired;
      console.log(`[${FP}] clamp->safe by sheetId`, { userEmail, in: nameToUse, out: repaired?.name });
    }

    // Attach the sheetId if missing; no-op if already set elsewhere unique
    if (!target.sheetId) {
      try {
        await Folder.updateOne(
          { _id: target._id, userEmail, $or: [{ sheetId: { $exists: false } }, { sheetId: "" }] },
          { $set: { sheetId, source } }
        );
        target = await Folder.findById(target._id);
      } catch (e: any) {
        // If unique index collides (sheetId already mapped to another folder), load that folder
        const fallback = await Folder.findOne({ userEmail, sheetId });
        if (fallback) return fallback;
        throw e;
      }
    }

    return target!;
  }

  // ---------- B) No sheetId: honor explicit name (never system) ----------
  if (desiredName) {
    const chosenName = isSystemFolder(desiredName) ? `${desiredName} (Leads)` : desiredName;
    let doc = await upsertFolderByName(userEmail, chosenName, source);

    if (!doc?.name || isSystemFolder(doc.name)) {
      const repaired = await upsertFolderByName(userEmail, safeDefault, source);
      console.log(`[${FP}] clamp:name provided`, { userEmail, in: desiredName, out: repaired?.name });
      return repaired;
    }
    return doc;
  }

  // ---------- C) If folderId provided and belongs to user and not system ----------
  if (folderId && mongoose.isValidObjectId(folderId)) {
    const fid = new mongoose.Types.ObjectId(folderId);
    const found = await Folder.findOne({ _id: fid, userEmail });
    if (found && !isSystemFolder(found.name)) {
      return found;
    }
    // else fall through to default
  }

  // ---------- D) Default safe upsert (never system) ----------
  let defDoc = await upsertFolderByName(userEmail, safeDefault, source);
  if (!defDoc?.name || isSystemFolder(defDoc.name)) {
    const repaired = await upsertFolderByName(userEmail, `${safeDefault} (Leads)`, source);
    console.log(`[${FP}] clamp:default`, { userEmail, in: baseDefault, out: repaired?.name });
    return repaired;
  }
  return defDoc;
}
