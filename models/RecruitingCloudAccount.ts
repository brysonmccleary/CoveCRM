import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const RecruitingCloudAccountSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
    platform: { type: String, enum: ["linkedin", "instagram"], required: true, immutable: true },
    provider: { type: String, enum: ["browserbase"], default: "browserbase", immutable: true },
    providerContextId: { type: String, required: true, select: false, immutable: true },
    loginSessionId: { type: String, default: null, select: false },
    status: {
      type: String,
      enum: ["connecting", "active", "reauth_required", "paused", "canceled"],
      default: "connecting",
      index: true,
    },
    consentVersion: { type: String, required: true, immutable: true },
    consentAcceptedAt: { type: Date, required: true, immutable: true },
    region: { type: String, enum: ["us-west-2", "us-east-1"], default: "us-west-2", immutable: true },
    timeZone: { type: String, default: "America/Phoenix", trim: true },
    dailyDmLimit: { type: Number, min: 1, max: 50, default: 20 },
    profileUrl: { type: String, default: "", trim: true },
    lastAuthenticatedAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastActionAt: { type: Date, default: null },
    lastRecipientLock: { type: String, default: null },
    lastAlertSentAt: { type: Date, default: null },
    lastGrowthSnapshotAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    workerLeaseExpiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

RecruitingCloudAccountSchema.index(
  { ownerEmail: 1, platform: 1 },
  { unique: true, partialFilterExpression: { canceledAt: null } },
);
RecruitingCloudAccountSchema.index({ status: 1, workerLeaseExpiresAt: 1, lastActionAt: 1 });

export type RecruitingCloudAccount = InferSchemaType<typeof RecruitingCloudAccountSchema>;
export default (models.RecruitingCloudAccount as mongoose.Model<RecruitingCloudAccount>) ||
  model<RecruitingCloudAccount>("RecruitingCloudAccount", RecruitingCloudAccountSchema);
