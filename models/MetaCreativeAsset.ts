import mongoose, { Schema, models } from "mongoose";

const MetaCreativeAssetSchema = new Schema(
  {
    assetId: { type: String, required: true, unique: true, immutable: true },
    assetType: {
      type: String,
      enum: [
        "STATIC_IMAGE", "BACKGROUND_IMAGE", "GRAPHIC", "PORTRAIT", "LIFESTYLE",
        "NOTICE_TEXTURE", "PATRIOTIC", "HOME", "TRUCK", "FINANCIAL_EDUCATION",
        "FINAL_EXPENSE_FAMILY", "SPANISH_NATIVE", "AGENT_VIDEO", "UGC_VIDEO",
        "STORY_VIDEO", "EXPLAINER_VIDEO", "OTHER_APPROVED",
      ],
      required: true,
      default: "OTHER_APPROVED",
      index: true,
    },
    verticals: { type: [String], required: true, default: [] },
    audienceSegments: { type: [String], required: true, default: [] },
    products: { type: [String], required: true, default: [] },
    languages: { type: [String], required: true, default: ["en"] },
    format: { type: String, enum: ["photo", "graphic", "texture", "video", "ugc_video", "agent_video"], required: true },
    direction: { type: String, required: true, index: true },
    imageDirection: { type: String, required: true, default: "", index: true },
    visualClass: { type: String, required: true, default: "", index: true },
    compatibleFamilies: { type: [String], required: true, default: [] },
    layoutCompatibility: { type: [String], required: true, default: ["*"] },
    orientation: { type: String, enum: ["landscape", "portrait", "square", "other"], default: "landscape" },
    aspectRatio: { type: String, required: true, default: "" },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    subjectClass: { type: String, default: "" },
    backgroundClass: { type: String, default: "" },
    source: { type: String, required: true },
    sourceUrl: { type: String, default: "" },
    storageUrl: { type: String, required: true },
    contentHash: { type: String, required: true, unique: true },
    semanticFingerprint: { type: String, required: true, default: "", index: true },
    visualFingerprint: { type: String, required: true, default: "", index: true },
    ownershipStatus: { type: String, enum: ["owned", "licensed", "third_party", "unknown"], required: true, default: "unknown" },
    licenseStatus: { type: String, enum: ["owned", "licensed", "approved_stock", "unknown"], required: true },
    approvalStatus: { type: String, enum: ["approved", "pending", "rejected", "retired"], default: "pending", index: true },
    approvalSource: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    rejectionReasons: { type: [String], default: [] },
    useCount: { type: Number, default: 0 },
    recentUsage: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

MetaCreativeAssetSchema.index({ verticals: 1, format: 1, approvalStatus: 1, active: 1 });
MetaCreativeAssetSchema.index({ verticals: 1, audienceSegments: 1, products: 1, languages: 1, approvalStatus: 1, active: 1 });
MetaCreativeAssetSchema.index({ compatibleFamilies: 1, layoutCompatibility: 1, approvalStatus: 1, active: 1 });
MetaCreativeAssetSchema.index({ direction: 1, useCount: 1, lastUsedAt: 1 });

export default models.MetaCreativeAsset || mongoose.model("MetaCreativeAsset", MetaCreativeAssetSchema);
