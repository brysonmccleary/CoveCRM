// models/CRMOutcome.ts
// CRM outcome tracking — one record per (campaignId, userId, date)
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const CRMOutcomeSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
    date: { type: String, required: true }, // "YYYY-MM-DD"

    // Disposition outcome counts
    appointmentsBooked: { type: Number, default: 0 },
    appointmentsShowed: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    notInterested: { type: Number, default: 0 },
    badNumbers: { type: Number, default: 0 },
    optOuts: { type: Number, default: 0 },

    // Derived cost-per metrics (calculated at scoring time)
    costPerBooked: { type: Number, default: null },
    costPerShow: { type: Number, default: null },
    costPerSale: { type: Number, default: null },
  },
  { timestamps: true }
);

CRMOutcomeSchema.index({ campaignId: 1, date: 1 });
CRMOutcomeSchema.index({ userId: 1, date: 1 });

export type CRMOutcome = InferSchemaType<typeof CRMOutcomeSchema>;
export default (models.CRMOutcome as mongoose.Model<CRMOutcome>) ||
  model<CRMOutcome>("CRMOutcome", CRMOutcomeSchema);
