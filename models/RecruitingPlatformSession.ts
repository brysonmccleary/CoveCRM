import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const RecruitingPlatformSessionSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
    companionId: { type: Schema.Types.ObjectId, ref: "RecruitingCompanion", required: true, index: true, immutable: true },
    platform: { type: String, enum: ["linkedin", "instagram"], required: true, immutable: true },
    status: { type: String, enum: ["active", "logged_out"], required: true, index: true },
    lastDetectedAt: { type: Date, default: Date.now },
    lastAlertSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

RecruitingPlatformSessionSchema.index({ companionId: 1, platform: 1 }, { unique: true });

export type RecruitingPlatformSession = InferSchemaType<typeof RecruitingPlatformSessionSchema>;
export default (models.RecruitingPlatformSession as mongoose.Model<RecruitingPlatformSession>) ||
  model<RecruitingPlatformSession>("RecruitingPlatformSession", RecruitingPlatformSessionSchema);
