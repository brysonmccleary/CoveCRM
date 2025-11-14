// lib/folders/ensureNonSystemFolderId.ts
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import { isSystemFolderName as isSystemFolder, isSystemish } from "@/lib/systemFolders";

type FolderDoc = {
  _id: mongoose.Types.ObjectId;
  userEmail: string;
  name: string;
  source?: string;
} | null;

/**
 * Final safety net:
 *  - Ensures the folder belongs to this user
 *  - NEVER returns a system folder
 *  - If the given folder is system-ish, creates a fresh safe folder for this user
 */
export async function ensureNonSystemFolderId(
  userEmail: string,
  folderId: mongoose.Types.ObjectId | string,
  fallbackName?: string
): Promise<{ folderId: mongoose.Types.ObjectId; folderName: string }> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB connection not ready");

  const coll = db.collection("folders");
  const _id =
    typeof folderId === "string" ? new mongoose.Types.ObjectId(folderId) : folderId;

  // 1) Look up the folder for this user
  let doc = (await coll.findOne({ _id, userEmail })) as FolderDoc;

  // If not found, but we have a name, create it (non-system only)
  if (!doc) {
    let baseName = (fallbackName || "").trim() || "Imported Leads";
    if (isSystemFolder(baseName) || isSystemish(baseName)) {
      baseName = `${baseName} (Leads)`;
    }

    const ins = await coll.insertOne({
      userEmail,
      name: baseName,
      source: "auto-created",
    });
    doc = (await coll.findOne({ _id: ins.insertedId })) as FolderDoc;
  }

  if (!doc || !doc.name) {
    throw new Error("Failed to resolve folder for user");
  }

  // 2) If this folder is system-ish, create a fresh safe folder instead
  if (isSystemFolder(doc.name) || isSystemish(doc.name)) {
    const safeName = `${doc.name} — ${Date.now()}`;
    const ins = await coll.insertOne({
      userEmail,
      name: safeName,
      source: "auto-sanitized",
    });
    const fresh = (await coll.findOne({ _id: ins.insertedId })) as FolderDoc;

    if (!fresh || !fresh.name || isSystemFolder(fresh.name) || isSystemish(fresh.name)) {
      throw new Error("Folder rewrite failed to produce a non-system folder");
    }

    return {
      folderId: fresh._id,
      folderName: fresh.name,
    };
  }

  // 3) Already safe, just return as-is
  return {
    folderId: doc._id,
    folderName: doc.name,
  };
}
