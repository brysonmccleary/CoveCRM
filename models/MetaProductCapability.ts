import mongoose, { Schema, models } from "mongoose";

const MetaProductCapabilitySchema = new Schema(
  {
    capabilityId: { type: String, required: true, unique: true, immutable: true },
    carrier: { type: String, required: true },
    product: { type: String, required: true },
    productIdentifier: { type: String, required: true },
    products: { type: [String], required: true, default: [] },
    states: { type: [String], required: true, default: [] },
    issueAgeMin: { type: Number, default: null },
    issueAgeMax: { type: Number, default: null },
    faceAmountMin: { type: Number, default: null },
    faceAmountMax: { type: Number, default: null },
    waitingPeriodRules: { type: [String], default: [] },
    immediateBenefitRules: { type: [String], default: [] },
    gradedBenefitRules: { type: [String], default: [] },
    medicalExamRequirement: {
      type: String,
      enum: ["required", "not_required", "conditional", "unknown"],
      default: "unknown",
    },
    underwritingType: { type: String, default: "" },
    premiumGuarantees: { type: [String], default: [] },
    benefitGuarantees: { type: [String], default: [] },
    livingBenefits: { type: [String], default: [] },
    taxTreatmentCapabilities: { type: [String], default: [] },
    approvalSpeedCapabilities: { type: [String], default: [] },
    otherCapabilities: { type: [String], default: [] },
    effectiveDate: { type: Date, required: true },
    expiresAt: { type: Date, default: null },
    approvalSource: { type: String, required: true },
    approvalMetadata: { type: Schema.Types.Mixed, default: {} },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

MetaProductCapabilitySchema.index({ productIdentifier: 1, active: 1 });
MetaProductCapabilitySchema.index({ products: 1, states: 1, active: 1 });

export default models.MetaProductCapability
  || mongoose.model("MetaProductCapability", MetaProductCapabilitySchema);
