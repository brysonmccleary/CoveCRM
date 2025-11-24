// models/Folder.ts
import mongoose, { Schema, models, model } from "mongoose";

// Flexible schema — we keep this loose to avoid breaking existing data.
const FolderSchema = new Schema({}, { strict: false, timestamps: true });

const Folder =
  (models.Folder as mongoose.Model<any>) || model("Folder", FolderSchema);
export default Folder;

// ---------------------------------------------------------------------------
// System folder helpers
// Keep in sync with lib/systemFolders, but *do not* include Vet Leads.
// ---------------------------------------------------------------------------

export const SYSTEM_FOLDERS = [
  "Sold",
  "Not Interested",
  "Booked Appointment",
] as const;

export type SystemFolderName = (typeof SYSTEM_FOLDERS)[number];

const CANONICAL_LOWER = new Set(SYSTEM_FOLDERS.map((s) => s.toLowerCase()));

function safeNormalize(name?: string | null): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Strict server-side check (mirror of lib/systemFolders). */
export function isSystemFolderName(name?: string | null): boolean {
  const n = safeNormalize(name);
  if (!n) return false;
  if (CANONICAL_LOWER.has(n)) return true;
  if (n === "booked") return true; // shorthand for “Booked Appointment”
  return false;
}

/** Softer heuristic, only for UX. */
export function isSystemish(name?: string | null): boolean {
  const n = safeNormalize(name);
  if (!n) return false;
  if (isSystemFolderName(n)) return true;
  const compact = n.replace(/\s+/g, "");
  if (compact === "sold" || compact === "solds") return true;
  if (compact === "notinterested") return true;
  if (compact === "booked" || compact === "bookedappointment") return true;
  return false;
}
