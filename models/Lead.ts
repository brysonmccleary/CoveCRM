// /models/Lead.ts
import mongoose, { Schema, Model, models } from "mongoose";

// Keep typing permissive so API routes can set arbitrary fields safely.
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
    // Allow flexible fields; we still define common identifiers for indexes
    userEmail: { type: String, index: true },
    folderId: { type: Schema.Types.ObjectId, ref: "Folder", index: true },
    phoneLast10: { type: String, index: true },
    normalizedPhone: { type: String, index: true },
    Email: { type: String, index: true, lowercase: true, trim: true },
    email: { type: String, index: true, lowercase: true, trim: true },
    status: { type: String, default: "New" },
  },
  {
    strict: false, // accept arbitrary columns from CSV/Sheets (e.g., "First Name")
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  }
);

// De-dupe friendly compound indexes (per user)
LeadSchema.index({ userEmail: 1, phoneLast10: 1 });
LeadSchema.index({ userEmail: 1, normalizedPhone: 1 });
LeadSchema.index({ userEmail: 1, Email: 1 });
LeadSchema.index({ userEmail: 1, email: 1 });

// Model reuse on hot reloads
const Lead: Model<LeadDoc> = (models.Lead as Model<LeadDoc>) || mongoose.model<LeadDoc>("Lead", LeadSchema);

export default Lead;
export type { LeadDoc as ILead };
