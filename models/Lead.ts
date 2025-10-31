// /models/Lead.ts
import mongoose, { Schema, Model, models } from "mongoose";

// Strict document type for actual Mongo docs
export type LeadDoc = mongoose.Document & {
  userEmail?: string;
  folderId?: mongoose.Types.ObjectId;
  phoneLast10?: string;
  normalizedPhone?: string;
  Email?: string;
  email?: string;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: any; // allow dynamic fields (First Name, Notes, etc.)
};

const LeadSchema = new Schema<LeadDoc>(
  {
    userEmail: { type: String, index: true },
    folderId: { type: Schema.Types.ObjectId, ref: "Folder", index: true },
    phoneLast10: { type: String, index: true },
    normalizedPhone: { type: String, index: true },
    Email: { type: String, index: true, lowercase: true, trim: true },
    email: { type: String, index: true, lowercase: true, trim: true },
    status: { type: String, default: "New" },
  },
  {
    strict: false, // accept arbitrary CSV/Sheets columns (e.g., "First Name")
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  }
);

// De-dupe friendly compound indexes (per user)
LeadSchema.index({ userEmail: 1, phoneLast10: 1 });
LeadSchema.index({ userEmail: 1, normalizedPhone: 1 });
LeadSchema.index({ userEmail: 1, Email: 1 });
LeadSchema.index({ userEmail: 1, email: 1 });

// Reuse model in dev/hot-reload
const Lead: Model<LeadDoc> =
  (models.Lead as Model<LeadDoc>) || mongoose.model<LeadDoc>("Lead", LeadSchema);

export default Lead;

// ---- Exports for typing ----
// Back-compat: many places annotate plain objects as `ILead` before saving.
// Keep `ILead` as a permissive POJO type so object literals are assignable.
export type ILead = Record<string, any>;

// If any file needs the strict Mongoose doc, import { LeadDoc } explicitly.
export type { LeadDoc };
