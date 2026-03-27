// models/AdActionReport.ts
// AI-generated daily/weekly action reports for FB campaigns
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const AdActionReportSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    type: { type: String, enum: ["daily", "weekly"], required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD" of the report run

    // Generated report content
    reportText: { type: String, required: true },
    summary: { type: String, default: "" },

    // Per-campaign actions included in report
    campaignActions: [
      {
        campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign" },
        campaignName: { type: String },
        action: { type: String }, // SCALE | PAUSE | FIX | MONITOR | DUPLICATE_TEST
        reasoning: { type: String },
        performanceScore: { type: Number },
        performanceClass: { type: String },
      },
    ],

    // Weekly market intelligence (weekly reports only)
    marketIntelligence: {
      topCompetitorHooks: [{ type: String }],
      trendingSentiment: { type: String, default: "" },
      recommendedAngles: [{ type: String }],
      suggestedAdChanges: { type: String, default: "" },
    },

    generatedAt: { type: Date, default: Date.now },
    tokensUsed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

AdActionReportSchema.index({ userId: 1, type: 1, date: -1 });
AdActionReportSchema.index({ userEmail: 1, type: 1, generatedAt: -1 });

export type AdActionReport = InferSchemaType<typeof AdActionReportSchema>;
export default (models.AdActionReport as mongoose.Model<AdActionReport>) ||
  model<AdActionReport>("AdActionReport", AdActionReportSchema);
