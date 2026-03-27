// models/PlatformSender.ts
// Represents each CoveCRM sending address used for platform-level outreach to DOI leads.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const PlatformSenderSchema = new Schema(
  {
    label: { type: String, required: true },       // e.g. "Sender 2", "Outreach A"
    fromName: { type: String, required: true },
    fromEmail: { type: String, required: true, index: true },
    smtpHost: { type: String, required: true },
    smtpPort: { type: Number, required: true, default: 587 },
    smtpUser: { type: String, required: true },
    // Password stored AES-256 encrypted using ENCRYPTION_KEY env var
    smtpPass: { type: String, required: true },
    smtpSecure: { type: Boolean, default: false },  // true = port 465 TLS
    dailyLimit: { type: Number, default: 200 },
    sentToday: { type: Number, default: 0 },
    lastResetAt: { type: Date, default: () => new Date() },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export type PlatformSender = InferSchemaType<typeof PlatformSenderSchema>;
export default (models.PlatformSender as mongoose.Model<PlatformSender>) ||
  model<PlatformSender>("PlatformSender", PlatformSenderSchema);
