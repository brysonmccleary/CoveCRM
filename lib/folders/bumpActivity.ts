import mongoose from "mongoose";
import Folder from "@/models/Folder";

/**
 * Mark a folder as recently active so it sorts to the top.
 * Safe no-op if the folder doesn't belong to the user.
 *
 * Behavior:
 * - Sets `bumpedAt` to now (used by queries to sort newest first).
 * - Also refreshes `updatedAt` for good measure.
 * - Optionally records a short `lastActivity` hint (debug/analytics only).
 */
export async function bumpFolderActivity(
  userEmail: string,
  folderId: mongoose.Types.ObjectId | string,
  hint?: string
): Promise<void> {
  const _id =
    typeof folderId === "string" ? new mongoose.Types.ObjectId(folderId) : folderId;
  const now = new Date();

  const set: Record<string, any> = {
    bumpedAt: now,
    updatedAt: now,
  };
  if (hint) set.lastActivity = hint;

  // Do not throw if it doesn't match; this is best-effort metadata.
  await Folder.updateOne({ _id, userEmail }, { $set: set }).exec();
}
