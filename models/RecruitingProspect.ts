import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const RecruitingProspectSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "RecruitingCampaign", required: true, index: true },
    platform: { type: String, enum: ["linkedin", "instagram"], required: true, index: true },
    externalRecipientId: { type: String, required: true, trim: true },
    profileUrl: { type: String, required: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    headline: { type: String, default: "", trim: true },
    publicFitEvidence: [{ type: String, trim: true }],
    fitReason: { type: String, default: "", trim: true },
    confidenceScore: { type: Number, min: 0, max: 1, default: null },
    confidenceTier: { type: String, enum: ["high", "medium", "low"], default: null, index: true },
    qualificationModel: { type: String, default: "", trim: true },
    recipientLock: { type: String, required: true },
    snapshotCapturedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["captured", "reviewed", "queued", "responded", "do_not_contact", "archived"],
      default: "captured",
      index: true,
    },
  },
  { timestamps: true },
);

RecruitingProspectSchema.index(
  { ownerEmail: 1, platform: 1, externalRecipientId: 1 },
  { unique: true },
);
RecruitingProspectSchema.index({ ownerEmail: 1, campaignId: 1, createdAt: -1 });

export type RecruitingProspect = InferSchemaType<typeof RecruitingProspectSchema>;
export default (models.RecruitingProspect as mongoose.Model<RecruitingProspect>) ||
  model<RecruitingProspect>("RecruitingProspect", RecruitingProspectSchema);
