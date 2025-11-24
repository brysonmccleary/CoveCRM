// models/Folder.ts
import mongoose, { Schema, models, model } from "mongoose";

// Canonical Folder shape in-app
export interface IFolder extends mongoose.Document {
  name: string;
  userEmail: string;
  assignedDrips: any[];
  createdAt: Date;
  updatedAt: Date;
}

// Explicit schema for clarity, but keep strict:false so legacy fields
// (like `user`, old flags, etc.) do NOT break anything.
// Use Schema<any> so TypeScript doesn't freak out about Mixed[].
const FolderSchema = new Schema<any>(
  {
    name: { type: String, required: true, trim: true },
    userEmail: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    assignedDrips: {
      // array of arbitrary objects
      type: [Schema.Types.Mixed],
      default: [],
    },
  },
  {
    timestamps: true,
    strict: false, // allow legacy fields, we just won’t rely on them
  }
);

// Helpful index for per-user/system-name lookups
FolderSchema.index({ userEmail: 1, name: 1 });

const Folder =
  (models.Folder as mongoose.Model<IFolder>) ||
  model<IFolder>("Folder", FolderSchema);
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
