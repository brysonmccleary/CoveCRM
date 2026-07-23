import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const RecruitingSocialActionSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "RecruitingCampaign", required: true, index: true },
    prospectId: { type: Schema.Types.ObjectId, ref: "RecruitingProspect", default: null, index: true },
    platform: { type: String, enum: ["linkedin", "instagram"], required: true, index: true },
    actionType: { type: String, enum: ["dm", "like_post", "like_story", "follow", "connect"], required: true },
    executionMode: { type: String, enum: ["simulation", "hosted_cloud"], default: "simulation", immutable: true },
    targetSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
    recipientLock: { type: String, required: true, immutable: true },
    message: { type: String, default: "", immutable: true },
    idempotencyKey: { type: String, required: true, immutable: true },
    status: {
      type: String,
      enum: ["simulated", "blocked", "canceled"],
      default: "simulated",
      index: true,
    },
    providerRequestMade: { type: Boolean, default: false, immutable: true },
    validationSummary: { type: String, default: "" },
  },
  { timestamps: true },
);

RecruitingSocialActionSchema.index(
  { ownerEmail: 1, idempotencyKey: 1 },
  { unique: true },
);
RecruitingSocialActionSchema.index({ ownerEmail: 1, campaignId: 1, createdAt: -1 });

export type RecruitingSocialAction = InferSchemaType<typeof RecruitingSocialActionSchema>;
export default (models.RecruitingSocialAction as mongoose.Model<RecruitingSocialAction>) ||
  model<RecruitingSocialAction>("RecruitingSocialAction", RecruitingSocialActionSchema);
