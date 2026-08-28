import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

// Ad-granular source of truth. Missing Meta or CRM fields remain null rather
// than being fabricated as zero. Campaign-level AdMetricsDaily is retained for
// backward-compatible dashboards and historical totals.
const MetaAdMetricsDailySchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    metaCampaignId: { type: String, default: "", index: true },
    metaAdsetId: { type: String, default: "", index: true },
    metaAdId: { type: String, required: true, index: true },
    metaCreativeId: { type: String, default: "", index: true },
    creativeFamily: { type: String, default: "", index: true },
    layoutId: { type: String, default: "", index: true },
    variantId: { type: String, default: "", index: true },
    hookClass: { type: String, default: "", index: true },
    imageIdentity: { type: String, default: "" },
    backgroundIdentity: { type: String, default: "" },

    spend: { type: Number, default: null },
    impressions: { type: Number, default: null },
    reach: { type: Number, default: null },
    frequency: { type: Number, default: null },
    clicks: { type: Number, default: null },
    linkClicks: { type: Number, default: null },
    ctr: { type: Number, default: null },
    cpc: { type: Number, default: null },
    cpm: { type: Number, default: null },
    landingPageViews: { type: Number, default: null },
    landingPageViewRate: { type: Number, default: null },
    leads: { type: Number, default: null },
    cpl: { type: Number, default: null },

    contactAttempted: { type: Number, default: 0 },
    contacted: { type: Number, default: 0 },
    qualifiedLeads: { type: Number, default: 0 },
    unqualifiedLeads: { type: Number, default: 0 },
    wrongAudience: { type: Number, default: 0 },
    badNumbers: { type: Number, default: 0 },
    duplicateOptIns: { type: Number, default: 0 },
    appointmentsBooked: { type: Number, default: 0 },
    noShows: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },
    optOuts: { type: Number, default: 0 },

    qualifiedLeadCpl: { type: Number, default: null },
    contactRate: { type: Number, default: null },
    appointmentCpl: { type: Number, default: null },
    saleAcquisitionCost: { type: Number, default: null },
  },
  { timestamps: true }
);

MetaAdMetricsDailySchema.index({ userEmail: 1, metaAdId: 1, date: 1 }, { unique: true });
MetaAdMetricsDailySchema.index({ creativeFamily: 1, layoutId: 1, date: -1 });
MetaAdMetricsDailySchema.index({ campaignId: 1, date: 1 });

export type MetaAdMetricsDaily = InferSchemaType<typeof MetaAdMetricsDailySchema>;
export default (models.MetaAdMetricsDaily as mongoose.Model<MetaAdMetricsDaily>)
  || model<MetaAdMetricsDaily>("MetaAdMetricsDaily", MetaAdMetricsDailySchema);
