// models/AdMetricsDaily.ts
// Daily ad metrics snapshot per campaign — entered manually or via Meta API
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const AdMetricsDailySchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    date: { type: String, required: true }, // "YYYY-MM-DD"

    // Core ad metrics
    spend: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    leads: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    frequency: { type: Number, default: 0 },

    // Derived
    cpl: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 }, // click-through rate %

    // CRM outcome fields (populated by trackCRMOutcome)
    appointmentsBooked: { type: Number, default: 0 },
    appointmentsShowed: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    notInterested: { type: Number, default: 0 },
    badNumbers: { type: Number, default: 0 },
    optOuts: { type: Number, default: 0 },

    // Notes
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

AdMetricsDailySchema.index({ campaignId: 1, date: 1 }, { unique: true });
AdMetricsDailySchema.index({ userId: 1, date: 1 });

export type AdMetricsDaily = InferSchemaType<typeof AdMetricsDailySchema>;
export default (models.AdMetricsDaily as mongoose.Model<AdMetricsDaily>) ||
  model<AdMetricsDaily>("AdMetricsDaily", AdMetricsDailySchema);
