import mongoose, { Schema, models } from "mongoose";

const MetaCreativeAssetSchema = new Schema(
  {
    assetId: { type: String, required: true, unique: true, immutable: true },
    verticals: { type: [String], required: true, default: [] },
    audienceSegments: { type: [String], required: true, default: [] },
    languages: { type: [String], required: true, default: ["en"] },
    format: { type: String, enum: ["photo", "graphic", "texture", "video", "ugc_video", "agent_video"], required: true },
    direction: { type: String, required: true, index: true },
    subjectClass: { type: String, default: "" },
    backgroundClass: { type: String, default: "" },
    source: { type: String, required: true },
    sourceUrl: { type: String, default: "" },
    storageUrl: { type: String, required: true },
    contentHash: { type: String, required: true, unique: true },
    licenseStatus: { type: String, enum: ["owned", "licensed", "approved_stock", "unknown"], required: true },
    approvalStatus: { type: String, enum: ["approved", "pending", "rejected", "retired"], default: "pending", index: true },
    approvalSource: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    useCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

MetaCreativeAssetSchema.index({ verticals: 1, format: 1, approvalStatus: 1, active: 1 });
MetaCreativeAssetSchema.index({ direction: 1, useCount: 1, lastUsedAt: 1 });

export default models.MetaCreativeAsset || mongoose.model("MetaCreativeAsset", MetaCreativeAssetSchema);
