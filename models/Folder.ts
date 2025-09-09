// /models/Folder.ts
import mongoose, { Schema, models, model } from "mongoose";
import { isSystemFolderName, isBlockedSystemName } from "@/lib/systemFolders";

/**
 * We keep strict: false to avoid refactors, but add hard guards so
 * no document can be created/renamed with a system or look-alike name.
 */
const FolderSchema = new Schema({}, { strict: false, timestamps: true });

function extractNameFromUpdate(update: any): string | undefined {
  if (!update) return undefined;
  // prefer explicit $set/$setOnInsert, then fallback to top-level
  const setOnInsert = update.$setOnInsert && update.$setOnInsert.name;
  const set = update.$set && update.$set.name;
  const direct = update.name;
  const n = String(setOnInsert ?? set ?? direct ?? "").trim();
  return n || undefined;
}

function isBlocked(n?: string | null): boolean {
  const name = String(n ?? "").trim();
  if (!name) return false;
  return isSystemFolderName(name) || isBlockedSystemName(name);
}

// Block creates/renames on normal saves
FolderSchema.pre("save", function (next) {
  const n = String((this as any).get("name") ?? "").trim();
  if (isBlocked(n)) return next(new Error("Cannot create or rename to system folders"));
  next();
});

// Block creates/renames on findOneAndUpdate / upserts
FolderSchema.pre("findOneAndUpdate", function (next) {
  const n = extractNameFromUpdate(this.getUpdate());
  if (isBlocked(n)) return next(new Error("Cannot create or rename to system folders"));
  next();
});

const Folder =
  (models.Folder as mongoose.Model<any>) || model("Folder", FolderSchema);

export default Folder;
