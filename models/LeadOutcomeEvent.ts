import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const LeadOutcomeEventSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
    userEmail: { type: String, required: true, lowercase: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    folderId: { type: Schema.Types.ObjectId, ref: "Folder", default: null, index: true },
    campaignId: { type: Schema.Types.Mixed, default: null, index: true },
    metaCampaignId: { type: String, default: "", index: true },
    metaAdsetId: { type: String, default: "", index: true },
    metaAdId: { type: String, default: "", index: true },
    metaCreativeId: { type: String, default: "", index: true },
    visualVariantIndex: { type: Number, default: null, index: true },
    creativeArchetype: { type: String, default: "", index: true },
    variationType: { type: String, default: "", index: true },
    sourceType: { type: String, default: "", index: true },
    outcomeType: { type: String, required: true, index: true },
    normalizedDisposition: { type: String, required: true, index: true },
    rawDisposition: { type: String, default: "" },
    source: { type: String, required: true, index: true },
    occurredAt: { type: Date, required: true, default: () => new Date(), index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

LeadOutcomeEventSchema.index({ userEmail: 1, leadId: 1, occurredAt: -1 });
LeadOutcomeEventSchema.index({ campaignId: 1, occurredAt: -1 });
LeadOutcomeEventSchema.index({ metaCampaignId: 1, occurredAt: -1 });
LeadOutcomeEventSchema.index({ metaAdId: 1, occurredAt: -1 });
LeadOutcomeEventSchema.index({ creativeArchetype: 1, occurredAt: -1 });

export type LeadOutcomeEvent = InferSchemaType<typeof LeadOutcomeEventSchema>;

export default (models.LeadOutcomeEvent as mongoose.Model<LeadOutcomeEvent>) ||
  model<LeadOutcomeEvent>("LeadOutcomeEvent", LeadOutcomeEventSchema);
