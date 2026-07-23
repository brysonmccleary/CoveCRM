import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const RecruitingGrowthSnapshotSchema = new Schema({
  ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
  cloudAccountId: { type: Schema.Types.ObjectId, ref: "RecruitingCloudAccount", required: true, index: true, immutable: true },
  platform: { type: String, enum: ["instagram", "linkedin"], required: true, index: true, immutable: true },
  dayKey: { type: String, required: true, immutable: true },
  followerCount: { type: Number, min: 0, default: null },
  connectionCount: { type: Number, min: 0, default: null },
  capturedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: false });

RecruitingGrowthSnapshotSchema.index({ cloudAccountId: 1, dayKey: 1 }, { unique: true });
RecruitingGrowthSnapshotSchema.index({ ownerEmail: 1, platform: 1, capturedAt: 1 });

export type RecruitingGrowthSnapshot = InferSchemaType<typeof RecruitingGrowthSnapshotSchema>;
export default (models.RecruitingGrowthSnapshot as mongoose.Model<RecruitingGrowthSnapshot>) || model<RecruitingGrowthSnapshot>("RecruitingGrowthSnapshot", RecruitingGrowthSnapshotSchema);
