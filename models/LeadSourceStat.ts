// models/LeadSourceStat.ts
import mongoose, { Schema, models, model } from "mongoose";

const LeadSourceStatSchema = new Schema(
  {
    userEmail: { type: String, required: true },
    source: { type: String, required: true }, // e.g. "facebook_realtime", "csv_import"
    month: { type: String, required: true }, // "2026-03" format
    leadCount: { type: Number, default: 0 },
    contactedCount: { type: Number, default: 0 },
    bookedCount: { type: Number, default: 0 },
    soldCount: { type: Number, default: 0 },
    totalSpend: { type: Number, default: 0 }, // in dollars
  },
  { timestamps: true }
);

LeadSourceStatSchema.index({ userEmail: 1, source: 1, month: 1 }, { unique: true });

export default models.LeadSourceStat || model("LeadSourceStat", LeadSourceStatSchema);
