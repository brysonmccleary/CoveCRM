import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const RecruitingCompanionSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
    label: { type: String, required: true, trim: true },
    installationId: { type: String, default: null, index: true },
    pairingCodeHash: { type: String, required: true, select: false },
    pairingExpiresAt: { type: Date, required: true, index: true },
    pairedAt: { type: Date, default: null },
    tokenHash: { type: String, default: null, select: false, index: true },
    consentVersion: { type: String, default: null },
    consentAcceptedAt: { type: Date, default: null },
    allowedPlatforms: [{ type: String, enum: ["linkedin", "instagram"], required: true }],
    enabled: { type: Boolean, default: true, index: true },
    paused: { type: Boolean, default: true, index: true },
    dailyActionLimit: { type: Number, min: 1, max: 50, default: 25 },
    lastActionAt: { type: Date, default: null },
    lastRecipientLock: { type: String, default: null },
    lastSeenAt: { type: Date, default: null },
    extensionVersion: { type: String, default: null },
    timeZone: { type: String, default: "America/Phoenix", trim: true },
  },
  { timestamps: true },
);

RecruitingCompanionSchema.index({ ownerEmail: 1, createdAt: -1 });
RecruitingCompanionSchema.index(
  { installationId: 1 },
  { unique: true, partialFilterExpression: { installationId: { $type: "string" } } },
);

export type RecruitingCompanion = InferSchemaType<typeof RecruitingCompanionSchema>;
export default (models.RecruitingCompanion as mongoose.Model<RecruitingCompanion>) ||
  model<RecruitingCompanion>("RecruitingCompanion", RecruitingCompanionSchema);
