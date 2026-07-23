import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const RecruitingDiscoveryJobSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "RecruitingCampaign", required: true, index: true, immutable: true },
    companionId: { type: Schema.Types.ObjectId, ref: "RecruitingCompanion", default: null, index: true },
    cloudAccountId: { type: Schema.Types.ObjectId, ref: "RecruitingCloudAccount", default: null, index: true },
    platform: { type: String, enum: ["linkedin", "instagram"], required: true, index: true, immutable: true },
    searchQuery: { type: String, required: true, trim: true, immutable: true },
    searchQueries: [{ type: String, required: true, trim: true }],
    seedAccounts: [{ type: String, trim: true }],
    derivedSeedAccounts: [{ type: String, trim: true }],
    discoverySourceTypes: [{ type: String, trim: true }],
    sourceCursor: { type: Number, min: 0, default: 0 },
    audienceDescription: { type: String, required: true, trim: true, immutable: true },
    location: { type: String, default: "", trim: true, immutable: true },
    maxCandidatesPerScan: { type: Number, min: 1, max: 25, default: 10 },
    status: { type: String, enum: ["queued", "claimed", "paused"], default: "queued", index: true },
    availableAt: { type: Date, default: Date.now, index: true },
    claimedAt: { type: Date, default: null },
    leaseExpiresAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastCandidateCount: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    lastCompletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

RecruitingDiscoveryJobSchema.index({ companionId: 1, status: 1, availableAt: 1 });
RecruitingDiscoveryJobSchema.index({ cloudAccountId: 1, status: 1, availableAt: 1 });
RecruitingDiscoveryJobSchema.index({ campaignId: 1, platform: 1 }, { unique: true });

export type RecruitingDiscoveryJob = InferSchemaType<typeof RecruitingDiscoveryJobSchema>;
export default (models.RecruitingDiscoveryJob as mongoose.Model<RecruitingDiscoveryJob>) ||
  model<RecruitingDiscoveryJob>("RecruitingDiscoveryJob", RecruitingDiscoveryJobSchema);
