import mongoose from "mongoose";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

/**
 * Ensure the target folder for an import is NOT a system folder.
 * If the provided folder (by id/name) is a system folder, we will
 * resolve a safe sibling (e.g., "Sold (Leads)") or create it.
 */
export async function ensureNonSystemFolderId(
  userEmail: string,
  wantedId: mongoose.Types.ObjectId,
  wantedName?: string
): Promise<{ folderId: mongoose.Types.ObjectId; folderName: string }> {
  // Caller is already connected to Mongo (imports call dbConnect upstream).

  // 1) Try the requested folder directly.
  const f = await Folder.findOne({ _id: wantedId, userEmail }).lean<{
    _id: mongoose.Types.ObjectId;
    name?: string;
  } | null>();

  if (f && f.name && !isSystemFolder(f.name)) {
    // Already safe.
    return { folderId: f._id as mongoose.Types.ObjectId, folderName: String(f.name) };
  }

  // 2) Compute a safe base name.
  const baseRaw =
    (wantedName ?? (f?.name ?? "") ?? "").toString().trim() || "Imported Leads";
  const safeBase = isSystemFolder(baseRaw) ? `${baseRaw} (Leads)` : baseRaw;

  // 3) If a non-system folder with this exact safe name exists, reuse it.
  const existing = await Folder.findOne({ userEmail, name: safeBase }).lean<{
    _id: mongoose.Types.ObjectId;
    name?: string;
  } | null>();

  if (existing && existing.name && !isSystemFolder(existing.name)) {
    return { folderId: existing._id as mongoose.Types.ObjectId, folderName: String(existing.name) };
  }

  // 4) Create a new safe folder atomically via native driver for exact equality.
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB connection not ready");
  const coll = db.collection("folders");

  // Try insert safeBase first.
  const ins = await coll.insertOne({ userEmail, name: safeBase, source: "import-safety" });
  const created = (await coll.findOne({ _id: ins.insertedId })) as
    | { _id: mongoose.Types.ObjectId; name?: string }
    | null;

  const createdName = created?.name ?? safeBase;
  if (created && createdName && !isSystemFolder(createdName)) {
    return { folderId: created._id as mongoose.Types.ObjectId, folderName: String(createdName) };
  }

  // 5) Extremely defensive: if somehow still systemy, force a unique safe variant.
  const uniqueSafe = `${safeBase} — ${Date.now()}`;
  const ins2 = await coll.insertOne({ userEmail, name: uniqueSafe, source: "import-safety" });
  const created2 = (await coll.findOne({ _id: ins2.insertedId })) as
    | { _id: mongoose.Types.ObjectId; name?: string }
    | null;

  return {
    folderId: (created2?._id as mongoose.Types.ObjectId) ?? (ins2.insertedId as unknown as mongoose.Types.ObjectId),
    folderName: String(created2?.name ?? uniqueSafe),
  };
}
