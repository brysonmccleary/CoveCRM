// models/CRMOutcome.ts
// CRM outcome tracking — one record per (campaignId, userId, date)
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const CRMOutcomeSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
    leadEventId: { type: String, default: "", index: true },
    metaAdId: { type: String, default: "", index: true },
    metaCreativeId: { type: String, default: "" },
    variantId: { type: String, default: "", index: true },
    creativeFamily: { type: String, default: "", index: true },
    layoutId: { type: String, default: "", index: true },
    hookClass: { type: String, default: "" },
    imageIdentity: { type: String, default: "" },
    backgroundIdentity: { type: String, default: "" },
    date: { type: String, required: true }, // "YYYY-MM-DD"

    // Disposition outcome counts
    appointmentsBooked: { type: Number, default: 0 },
    appointmentsShowed: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 }, // ⚠️ ESTIMATED (flat per-lead-type guess) — never real money, never use for ROAS. See FBLeadCampaign.totalGrossRevenue.
    notInterested: { type: Number, default: 0 },
    badNumbers: { type: Number, default: 0 },
    optOuts: { type: Number, default: 0 },
    contactAttempted: { type: Number, default: 0 },
    contacted: { type: Number, default: 0 },
    qualifiedLeads: { type: Number, default: 0 },
    unqualifiedLeads: { type: Number, default: 0 },
    wrongAudience: { type: Number, default: 0 },
    duplicateOptIns: { type: Number, default: 0 },
    noShows: { type: Number, default: 0 },
    normalizedOutcome: {
      type: String,
      enum: ["NEW", "CONTACT_ATTEMPTED", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "WRONG_AUDIENCE", "BAD_NUMBER", "DUPLICATE_OPT_IN", "APPOINTMENT", "NO_SHOW", "SALE", "OPT_OUT", ""],
      default: "",
    },

    // Derived cost-per metrics (calculated at scoring time)
    costPerBooked: { type: Number, default: null },
    costPerShow: { type: Number, default: null },
    costPerSale: { type: Number, default: null },
  },
  { timestamps: true }
);

CRMOutcomeSchema.index({ campaignId: 1, date: 1 });
CRMOutcomeSchema.index({ userId: 1, date: 1 });
CRMOutcomeSchema.index({ userEmail: 1, campaignId: 1, date: 1, metaAdId: 1, creativeFamily: 1 });

export type CRMOutcome = InferSchemaType<typeof CRMOutcomeSchema>;
export default (models.CRMOutcome as mongoose.Model<CRMOutcome>) ||
  model<CRMOutcome>("CRMOutcome", CRMOutcomeSchema);
