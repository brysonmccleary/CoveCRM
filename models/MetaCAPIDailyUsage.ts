import mongoose, { Schema, models } from "mongoose";

const MetaCAPIDailyUsageSchema = new Schema(
  {
    userEmail: { type: String, required: true, immutable: true },
    date: { type: String, required: true, immutable: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

MetaCAPIDailyUsageSchema.index({ userEmail: 1, date: 1 }, { unique: true });

export default models.MetaCAPIDailyUsage || mongoose.model("MetaCAPIDailyUsage", MetaCAPIDailyUsageSchema);
