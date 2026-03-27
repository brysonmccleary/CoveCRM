// models/AgentEmailAccount.ts
// One record per agent's connected personal SMTP account.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const AgentEmailAccountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    fromName: { type: String, required: true },
    fromEmail: { type: String, required: true },
    smtpHost: { type: String, required: true },
    smtpPort: { type: Number, required: true, default: 587 },
    smtpUser: { type: String, required: true },
    // Password stored AES-256 encrypted using ENCRYPTION_KEY env var
    smtpPass: { type: String, required: true },
    smtpSecure: { type: Boolean, default: false }, // true = port 465 TLS
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    lastUsedAt: { type: Date },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

// One active SMTP account per user
AgentEmailAccountSchema.index({ userId: 1, active: 1 });

export type AgentEmailAccount = InferSchemaType<typeof AgentEmailAccountSchema>;
export default (models.AgentEmailAccount as mongoose.Model<AgentEmailAccount>) ||
  model<AgentEmailAccount>("AgentEmailAccount", AgentEmailAccountSchema);
