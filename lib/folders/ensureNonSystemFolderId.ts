import mongoose from "mongoose";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

/**
 * Resolve a NON-system folder and return its id+name.
 * - If `wantedId` is provided, it must belong to the user and not be a system folder.
 * - Otherwise, `wantedName` is required:
 *   - If it exists (non-system), return it.
 *   - Else upsert it (non-system), and return the created doc.
 * All branches include explicit null checks to satisfy TS.
 */
export default async function ensureNonSystemFolderId(
  userEmail: string,
  wantedId?: mongoose.Types.ObjectId | string | null,
  wantedName?: string | null,
): Promise<{ folderId: mongoose.Types.ObjectId; folderName: string }> {
  // ---- Branch A: Resolve by explicit ID
  if (wantedId) {
    const f = await Folder.findOne({ _id: wantedId, userEmail })
      .select("_id name userEmail")
      .lean<{ _id: mongoose.Types.ObjectId; name?: string; userEmail: string } | null>();

    if (!f) {
      throw new Error("Folder not found or not owned by user");
    }
    if (!f.name || isSystemFolder(f.name)) {
      throw new Error("Cannot import into system folders");
    }
    return { folderId: f._id, folderName: String(f.name) };
  }

  // ---- Branch B: Resolve by NAME (create if missing)
  const byName = String(wantedName ?? "").trim();
  if (!byName) {
    throw new Error("A folder name is required when no folderId is provided");
  }
  if (isSystemFolder(byName)) {
    throw new Error("Cannot import into system folders");
  }

  // Prefer native driver for exact equality w/o collation side-effects
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB connection not ready");

  const coll = db.collection("folders");

  // Try to find an existing non-system doc first
  const existing = await coll.findOne({
    userEmail,
    name: byName,
  });

  if (existing && typeof (existing as any).name === "string" && !isSystemFolder((existing as any).name)) {
    return {
      folderId: (existing as any)._id as mongoose.Types.ObjectId,
      folderName: String((existing as any).name),
    };
  }

  // Upsert a non-system doc
  const up = await coll.findOneAndUpdate(
    { userEmail, name: byName },
    { $setOnInsert: { userEmail, name: byName, source: "google-sheets" } },
    { upsert: true, returnDocument: "after" }
  );

  // TS/Runtime safety: handle null-ish result defensively
  const upValue = (up && (up as any).value) || null;

  if (upValue && typeof (upValue as any).name === "string" && !isSystemFolder((upValue as any).name)) {
    return {
      folderId: (upValue as any)._id as mongoose.Types.ObjectId,
      folderName: String((upValue as any).name),
    };
  }

  // Fallback: force a unique, safe non-system name
  const uniqueSafe = `${byName} — ${Date.now()}`;
  if (isSystemFolder(uniqueSafe)) {
    // Practically impossible, but guard anyway
    throw new Error("Unexpected system-folder rewrite; aborting for safety");
  }

  const ins = await coll.insertOne({
    userEmail,
    name: uniqueSafe,
    source: "google-sheets",
  });

  const fresh = await coll.findOne({ _id: ins.insertedId });

  if (!fresh || typeof (fresh as any).name !== "string" || isSystemFolder((fresh as any).name)) {
    throw new Error("Folder rewrite detected; could not ensure a non-system folder");
  }

  return {
    folderId: (fresh as any)._id as mongoose.Types.ObjectId,
    folderName: String((fresh as any).name),
  };
}
