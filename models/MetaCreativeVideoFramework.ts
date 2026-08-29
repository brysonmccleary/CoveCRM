import mongoose, { Schema, models } from "mongoose";

const MetaCreativeVideoFrameworkSchema = new Schema({
  frameworkId: { type: String, required: true, unique: true, immutable: true },
  vertical: { type: String, required: true, index: true },
  family: { type: String, required: true, index: true },
  language: { type: String, enum: ["en", "es"], required: true, index: true },
  script: { type: String, required: true },
  speakerType: { type: String, enum: ["licensed_agent", "educator", "narrator", "actor_no_testimonial"], required: true },
  durationSeconds: { type: Number, required: true },
  aspectRatio: { type: String, enum: ["9:16", "1:1", "4:5", "16:9"], required: true },
  captionTemplate: { type: String, required: true },
  cta: { type: String, required: true },
  claimRequirements: { type: [String], default: [] },
  productCompatibility: { type: [String], required: true, default: [] },
  approvalStatus: { type: String, enum: ["approved", "pending", "rejected", "retired"], default: "pending", index: true },
  approvalSource: { type: String, default: "" },
  approvedAt: { type: Date, default: null },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

MetaCreativeVideoFrameworkSchema.index({ vertical: 1, language: 1, approvalStatus: 1, active: 1 });

export default models.MetaCreativeVideoFramework
  || mongoose.model("MetaCreativeVideoFramework", MetaCreativeVideoFrameworkSchema);
