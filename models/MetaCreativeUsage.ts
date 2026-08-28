import mongoose, { Schema, models } from "mongoose";

const MetaCreativeUsageSchema = new Schema(
  {
    // Draft fingerprints are promoted to the final rendered-byte fingerprint
    // at launch, so this field cannot be schema-immutable.
    creativeFingerprint: { type: String, required: true },
    generationSignature: { type: String, required: true, immutable: true },
    status: { type: String, enum: ["draft_reserved", "reserved", "published", "expired", "released"], required: true, index: true },
    claimToken: { type: String, default: "", index: true },
    claimedAt: { type: Date, default: Date.now },
    publishedAt: { type: Date, default: null },
    userEmail: { type: String, required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", default: null, index: true },
    generationId: { type: String, default: "", index: true },
    reservationId: { type: String, default: "", index: true },
    expiresAt: { type: Date, default: null, index: true },
    leadType: { type: String, required: true, index: true },
    winningFamilyId: { type: String, default: "" },
    creativeClass: { type: String, default: "" },
    layoutId: { type: String, default: "" },
    hookClass: { type: String, default: "" },
    headline: { type: String, default: "" },
    primaryText: { type: String, default: "" },
    description: { type: String, default: "" },
    bulletPoints: { type: [String], default: [] },
    cta: { type: String, default: "" },
    imageDirection: { type: String, default: "" },
    imageIdentity: { type: String, default: "" },
    backgroundDirection: { type: String, default: "" },
    palette: { type: String, default: "" },
    offerClass: { type: String, default: "" },
    selectorSchema: { type: Schema.Types.Mixed, default: null },
    semanticFingerprint: { type: String, default: "", index: true },
    visualFingerprint: { type: String, default: "", index: true },
    variationType: { type: String, default: "" },
    metaAdId: { type: String, default: "" },
    metaCreativeId: { type: String, default: "" },
  },
  { timestamps: true }
);

MetaCreativeUsageSchema.index({ creativeFingerprint: 1 }, { unique: true });
MetaCreativeUsageSchema.index({ generationSignature: 1 }, { unique: true });
MetaCreativeUsageSchema.index({ userEmail: 1, createdAt: -1 });
MetaCreativeUsageSchema.index({ winningFamilyId: 1, layoutId: 1, createdAt: -1 });

export default models.MetaCreativeUsage || mongoose.model("MetaCreativeUsage", MetaCreativeUsageSchema);
