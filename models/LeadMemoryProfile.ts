import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const LeadMemoryProfileSchema = new Schema(
  {
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    shortSummary: { type: String, default: "" },
    longSummary: { type: String, default: "" },
    nextBestAction: { type: String, default: "" },
    openLoops: { type: [String], default: [] },
    objections: { type: [String], default: [] },
    preferences: { type: Schema.Types.Mixed, default: {} },
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

LeadMemoryProfileSchema.index({ userEmail: 1, leadId: 1 }, { unique: true });

export type LeadMemoryProfile = InferSchemaType<typeof LeadMemoryProfileSchema>;

export default (models.LeadMemoryProfile as mongoose.Model<LeadMemoryProfile>) ||
  model<LeadMemoryProfile>("LeadMemoryProfile", LeadMemoryProfileSchema);
