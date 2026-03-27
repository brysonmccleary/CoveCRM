// models/LeadStage.ts
import mongoose, { Schema, models, model } from "mongoose";

const LeadStageSchema = new Schema(
  {
    userEmail: { type: String, required: true, index: true },
    name: { type: String, required: true }, // e.g. "New", "Contacted", "Quoted", "Closed"
    color: { type: String, default: "#6366f1" }, // hex color
    order: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

LeadStageSchema.index({ userEmail: 1, order: 1 });

export default models.LeadStage || model("LeadStage", LeadStageSchema);
