import mongoose, { Schema, models } from "mongoose";

const MetaLaunchArchiveSchema = new Schema(
  {
    userEmail: { type: String, required: true, immutable: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", required: true, immutable: true },
    launchFingerprint: { type: String, required: true, immutable: true },
    leadType: { type: String, required: true, immutable: true },
    audienceSegment: { type: String, default: "standard", immutable: true },
    targetingProfile: { type: Schema.Types.Mixed, default: {}, immutable: true },
    licensedStates: { type: [String], required: true, immutable: true },
    adCopy: { type: Schema.Types.Mixed, required: true, immutable: true },
    images: { type: [Schema.Types.Mixed], required: true, immutable: true },
    landingPageSnapshot: { type: String, required: true, immutable: true },
    qualifierTexts: { type: [String], default: [], immutable: true },
    claims: { type: [Schema.Types.Mixed], default: [], immutable: true },
    destinationUrls: { type: [String], default: [], immutable: true },
    metaObjectIds: { type: Schema.Types.Mixed, required: true, immutable: true },
    archivedAt: { type: Date, default: Date.now, immutable: true },
  },
  { timestamps: true }
);

MetaLaunchArchiveSchema.index({ userEmail: 1, launchFingerprint: 1 }, { unique: true });

export default models.MetaLaunchArchive || mongoose.model("MetaLaunchArchive", MetaLaunchArchiveSchema);
