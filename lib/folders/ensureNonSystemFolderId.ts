import mongoose from "mongoose";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

export type EnsureFolderArgs =
  | mongoose.Types.ObjectId
  | string
  | {
      byId?: string | mongoose.Types.ObjectId | null | undefined;
      byName?: string | null | undefined;
      computedDefault?: string | null | undefined;
    };

export type EnsureFolderResult = {
  folderId: mongoose.Types.ObjectId;
  folderName: string;
};

export default async function ensureNonSystemFolderId(
  userEmail: string,
  arg?: EnsureFolderArgs
): Promise<EnsureFolderResult> {
  let byId: mongoose.Types.ObjectId | undefined;
  let byName: string | undefined;
  let computedDefault: string | undefined;

  if (!arg) {
    // noop; will require computedDefault later
  } else if (typeof arg === "string" || arg instanceof mongoose.Types.ObjectId) {
    byId =
      typeof arg === "string"
        ? new mongoose.Types.ObjectId(arg)
        : (arg as mongoose.Types.ObjectId);
  } else {
    if (arg.byId) {
      byId =
        typeof arg.byId === "string"
          ? new mongoose.Types.ObjectId(arg.byId)
          : (arg.byId as mongoose.Types.ObjectId);
    }
    if (arg.byName) byName = String(arg.byName).trim();
    if (arg.computedDefault) computedDefault = String(arg.computedDefault).trim();
  }

  // A) Explicit byId path — must belong to user and not be a system folder
  if (byId) {
    const f = (await Folder.findOne({ _id: byId, userEmail })
      .select("_id name")
      .lean()) as { _id: mongoose.Types.ObjectId; name?: string } | null;

    if (!f) throw new Error("Folder not found or not owned by user");
    if (f.name && isSystemFolder(f.name)) {
      throw new Error("Cannot import into system folders (by id)");
    }
    return { folderId: f._id, folderName: String(f.name || "") };
  }

  // Helper: force a non-system name
  const toSafeName = (name: string): string => {
    const base = name.trim();
    if (!base) return `Imported Leads — ${Date.now()}`;
    if (!isSystemFolder(base)) return base;
    return `${base} — ${Date.now()}`;
  };

  // B) byName path — upsert exact match after blocking system names
  if (byName && byName.trim()) {
    const safeName = toSafeName(byName);
    const up = (await Folder.findOneAndUpdate(
      { userEmail, name: safeName },
      { $setOnInsert: { userEmail, name: safeName, source: "google-sheets" } },
      { upsert: true, new: true }
    )
      .select("_id name")
      .lean()) as { _id: mongoose.Types.ObjectId; name?: string } | null;

    if (!up) throw new Error("Failed to create/find destination folder");
    if (up.name && isSystemFolder(up.name)) {
      const uniqueSafe = `${safeName} — ${Date.now()}`;
      const ins = (await Folder.findOneAndUpdate(
        { userEmail, name: uniqueSafe },
        { $setOnInsert: { userEmail, name: uniqueSafe, source: "google-sheets" } },
        { upsert: true, new: true }
      )
        .select("_id name")
        .lean()) as { _id: mongoose.Types.ObjectId; name?: string } | null;
      if (!ins) throw new Error("Failed to create safe destination folder");
      return { folderId: ins._id, folderName: String(ins.name || "") };
    }

    return { folderId: up._id, folderName: String(up.name || "") };
  }

  // C) computedDefault path — required if no byId and no byName
  const baseName = toSafeName(computedDefault || "");
  const up = (await Folder.findOneAndUpdate(
    { userEmail, name: baseName },
    { $setOnInsert: { userEmail, name: baseName, source: "google-sheets" } },
    { upsert: true, new: true }
  )
    .select("_id name")
    .lean()) as { _id: mongoose.Types.ObjectId; name?: string } | null;

  if (!up) throw new Error("Failed to compute destination folder");
  if (up.name && isSystemFolder(up.name)) {
    const uniqueSafe = `${baseName} — ${Date.now()}`;
    const ins = (await Folder.findOneAndUpdate(
      { userEmail, name: uniqueSafe },
      { $setOnInsert: { userEmail, name: uniqueSafe, source: "google-sheets" } },
      { upsert: true, new: true }
    )
      .select("_id name")
      .lean()) as { _id: mongoose.Types.ObjectId; name?: string } | null;
    if (!ins) throw new Error("Failed to create non-system folder");
    return { folderId: ins._id, folderName: String(ins.name || "") };
  }

  return { folderId: up._id, folderName: String(up.name || "") };
}
