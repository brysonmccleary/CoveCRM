// lib/folders/ensureNonSystemFolderId.ts
import mongoose from "mongoose";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

/**
 * Normalize visible names in a stable, idempotent way so we don't create
 * multiple nearly-identical folders (trailing spaces, duplicated dashes, etc.).
 */
function normalizeVisibleName(raw: string): string {
  let s = String(raw ?? "")
    .replace(/\u2014/g, "—")          // normalize em-dash
    .replace(/\s+/g, " ")             // collapse whitespace
    .replace(/\s*—\s*/g, " — ")       // normalize dash spacing
    .trim();

  // Remove dangling separators at the end: "-", "—", ",", etc.
  s = s.replace(/(?:[—\-:,])\s*$/g, "").trim();

  // Avoid empty
  if (!s) s = "Imported Leads";
  return s;
}

/**
 * If the chosen name is a system folder, rewrite deterministically to "<Name> (Leads)".
 * This keeps the same result every time (no timestamp suffix), preventing dupes.
 */
function toStableNonSystemName(name: string): string {
  const n = normalizeVisibleName(name);
  if (!isSystemFolder(n)) return n;
  // Example: "Sold" -> "Sold (Leads)"
  const rewritten = `${n} (Leads)`;
  // If that itself is somehow considered system in the project rules, fall back once more:
  return isSystemFolder(rewritten) ? `${n} (Imported Leads)` : rewritten;
}

/**
 * Ensure a single, non-system folder exists for this user, returning its id + name.
 * Tries: exact normalized match -> upsert -> final fallback (rare).
 */
export async function ensureNonSystemFolderId(
  userEmail: string,
  desiredNameOrId?: { byId?: mongoose.Types.ObjectId | string; byName?: string },
): Promise<{ folderId: mongoose.Types.ObjectId; folderName: string }> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB connection not ready");

  const coll = db.collection("folders");

  // 1) If folder ID provided, prefer it (but still enforce non-system name).
  if (desiredNameOrId?.byId) {
    const wantedId =
      typeof desiredNameOrId.byId === "string"
        ? new mongoose.Types.ObjectId(desiredNameOrId.byId)
        : (desiredNameOrId.byId as mongoose.Types.ObjectId);

    const f = (await coll.findOne({ _id: wantedId, userEmail })) as
      | { _id: mongoose.Types.ObjectId; name?: string }
      | null;

    if (!f) throw new Error("Folder not found or not owned by user");

    const visible = normalizeVisibleName(f.name || "");
    if (!isSystemFolder(visible)) {
      return { folderId: f._id, folderName: visible };
    }
    // Deterministic rewrite
    const stable = toStableNonSystemName(visible);
    const up = await coll.findOneAndUpdate(
      { _id: f._id, userEmail },
      { $set: { name: stable } },
      { returnDocument: "after" },
    );
    const v = up.value!;
    return { folderId: v._id as any, folderName: String(v.name) };
  }

  // 2) If by name, normalize, rewrite if system, then upsert by exact name.
  const rawName = desiredNameOrId?.byName || "Imported Leads";
  const safeName = toStableNonSystemName(rawName);

  // Try exact match first
  const foundExact = await coll.findOne({ userEmail, name: safeName });
  if (foundExact) {
    return {
      folderId: (foundExact as any)._id as any,
      folderName: String((foundExact as any).name),
    };
  }

  // Upsert exact name (no timestamp suffixes, deterministic)
  const created = await coll.findOneAndUpdate(
    { userEmail, name: safeName },
    {
      $setOnInsert: {
        userEmail,
        name: safeName,
        source: "google-sheets",
        createdAt: new Date(),
        lastActivityAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  const v = created.value!;
  // Final safety: if (for any reason) it's still system, do a one-time fallback.
  const finalName = normalizeVisibleName(v.name || safeName);
  if (!isSystemFolder(finalName)) {
    return { folderId: v._id as any, folderName: finalName };
  }

  const fallback = toStableNonSystemName(finalName);
  const fixed = await coll.findOneAndUpdate(
    { _id: v._id, userEmail },
    { $set: { name: fallback } },
    { returnDocument: "after" },
  );
  return { folderId: (fixed.value as any)._id as any, folderName: String((fixed.value as any).name) };
}

export default ensureNonSystemFolderId;
