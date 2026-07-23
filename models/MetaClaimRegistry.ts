import mongoose, { Schema, models } from "mongoose";

const MetaClaimRegistrySchema = new Schema(
  {
    claimText: { type: String, required: true },
    pattern: { type: String, required: true },
    classification: { type: String, enum: ["CLEAN", "QUALIFIED"], required: true },
    eligibleProducts: { type: [String], required: true, default: [] },
    carrierBasis: { type: String, required: true },
    requiredQualifierText: { type: String, default: "" },
    states: { type: [String], required: true, default: ["*"] },
    version: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    approvedBy: { type: String, required: true },
    approvalEvidence: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MetaClaimRegistrySchema.index({ claimText: 1, version: 1 }, { unique: true });

export default models.MetaClaimRegistry || mongoose.model("MetaClaimRegistry", MetaClaimRegistrySchema);
