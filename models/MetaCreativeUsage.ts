import mongoose, { Schema, models } from "mongoose";

const MetaCreativeUsageSchema = new Schema(
  {
    creativeFingerprint: { type: String, required: true, immutable: true },
    generationSignature: { type: String, required: true, immutable: true },
    status: { type: String, enum: ["reserved", "published"], required: true, index: true },
    claimToken: { type: String, default: "", index: true },
    claimedAt: { type: Date, default: Date.now },
    publishedAt: { type: Date, default: null },
    userEmail: { type: String, required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", required: true, index: true },
    leadType: { type: String, required: true, index: true },
    winningFamilyId: { type: String, default: "" },
    variationType: { type: String, default: "" },
    metaAdId: { type: String, default: "" },
    metaCreativeId: { type: String, default: "" },
  },
  { timestamps: true }
);

MetaCreativeUsageSchema.index({ creativeFingerprint: 1 }, { unique: true });
MetaCreativeUsageSchema.index({ generationSignature: 1 }, { unique: true });

export default models.MetaCreativeUsage || mongoose.model("MetaCreativeUsage", MetaCreativeUsageSchema);

