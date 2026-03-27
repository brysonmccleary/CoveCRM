// models/FBAdIntelligence.ts
// Stores winning ad patterns per lead type scanned from Facebook Ad Library.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const FBAdIntelligenceSchema = new Schema(
  {
    leadType: {
      type: String,
      enum: ["final_expense", "iul", "mortgage_protection", "veteran", "trucker"],
      required: true,
      index: true,
    },
    headline: { type: String, default: "" },
    primaryText: { type: String, default: "" },
    description: { type: String, default: "" },
    ctaButton: { type: String, default: "" },
    targetingNotes: { type: String, default: "" },
    estimatedCpl: { type: Number, default: 0 },
    performanceRating: { type: Number, min: 1, max: 5, default: 3 },
    scrapedFrom: {
      type: String,
      enum: ["facebook_ad_library"],
      default: "facebook_ad_library",
    },
    scrapedAt: { type: Date, default: () => new Date() },
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

FBAdIntelligenceSchema.index({ leadType: 1, active: 1, performanceRating: -1 });

export type FBAdIntelligence = InferSchemaType<typeof FBAdIntelligenceSchema>;
export default (models.FBAdIntelligence as mongoose.Model<FBAdIntelligence>) ||
  model<FBAdIntelligence>("FBAdIntelligence", FBAdIntelligenceSchema);
