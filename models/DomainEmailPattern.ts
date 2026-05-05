// models/DomainEmailPattern.ts
// Tracks per-domain email pattern performance for DOI enrichment.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const DomainEmailPatternSchema = new Schema(
  {
    domain: { type: String, required: true, index: true },
    pattern: { type: String, required: true },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    catchAll: { type: Boolean, default: false },
    confidenceScore: { type: Number, default: 0 },
    lastTestedAt: { type: Date },
    lastSuccessfulPattern: { type: String, default: "" },
    patternSuccessRate: { type: Number, default: 0 },
    totalTests: { type: Number, default: 0 },
    totalSuccess: { type: Number, default: 0 },
    totalFailures: { type: Number, default: 0 },
  },
  { timestamps: true }
);

DomainEmailPatternSchema.index({ domain: 1, pattern: 1 }, { unique: true });

export type DomainEmailPattern = InferSchemaType<typeof DomainEmailPatternSchema>;
export default (models.DomainEmailPattern as mongoose.Model<DomainEmailPattern>) ||
  model<DomainEmailPattern>("DomainEmailPattern", DomainEmailPatternSchema);
