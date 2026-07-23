import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const RecruitingCompanionJobSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "RecruitingCampaign", required: true, index: true, immutable: true },
    sourceActionId: { type: Schema.Types.ObjectId, ref: "RecruitingSocialAction", required: true, immutable: true },
    companionId: { type: Schema.Types.ObjectId, ref: "RecruitingCompanion", default: null, index: true },
    cloudAccountId: { type: Schema.Types.ObjectId, ref: "RecruitingCloudAccount", default: null, index: true },
    platform: { type: String, enum: ["linkedin", "instagram"], required: true, index: true, immutable: true },
    actionType: { type: String, enum: ["dm", "like_post", "like_story", "follow", "connect"], required: true, immutable: true },
    targetSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
    recipientLock: { type: String, required: true, immutable: true },
    message: { type: String, default: "", immutable: true },
    idempotencyKey: { type: String, required: true, immutable: true },
    sequence: { type: Number, min: 0, default: 0, immutable: true },
    status: {
      type: String,
      enum: ["queued", "claimed", "succeeded", "skipped", "failed", "blocked", "canceled"],
      default: "queued",
      index: true,
    },
    availableAt: { type: Date, default: Date.now, index: true },
    claimedAt: { type: Date, default: null },
    leaseExpiresAt: { type: Date, default: null, index: true },
    completedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    failureCode: { type: String, default: "" },
    resultSummary: { type: String, default: "" },
    pageUrlAtCompletion: { type: String, default: "" },
  },
  { timestamps: true },
);

RecruitingCompanionJobSchema.index({ ownerEmail: 1, idempotencyKey: 1 }, { unique: true });
RecruitingCompanionJobSchema.index({ status: 1, platform: 1, availableAt: 1, createdAt: 1, sequence: 1 });
RecruitingCompanionJobSchema.index({ cloudAccountId: 1, status: 1, availableAt: 1, sequence: 1 });

export type RecruitingCompanionJob = InferSchemaType<typeof RecruitingCompanionJobSchema>;
export default (models.RecruitingCompanionJob as mongoose.Model<RecruitingCompanionJob>) ||
  model<RecruitingCompanionJob>("RecruitingCompanionJob", RecruitingCompanionJobSchema);
