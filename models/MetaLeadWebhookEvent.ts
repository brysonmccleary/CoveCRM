// models/MetaLeadWebhookEvent.ts
import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const MetaLeadWebhookEventSchema = new Schema(
  {
    leadgenId: { type: String, required: true, unique: true, index: true },
    pageId: { type: String, default: "", index: true },
    formId: { type: String, default: "", index: true },
    adId: { type: String, default: "" },
    adsetId: { type: String, default: "" },
    metaCampaignId: { type: String, default: "", index: true },
    createdTime: { type: Schema.Types.Mixed, default: "" },
    rawPayload: { type: Schema.Types.Mixed, default: {} },
    rawEntry: { type: Schema.Types.Mixed, default: {} },
    rawChange: { type: Schema.Types.Mixed, default: {} },
    receivedAt: { type: Date, default: Date.now, index: true },
    lastReceivedAt: { type: Date, default: Date.now },
    processingStatus: {
      type: String,
      enum: [
        "received",
        "processing",
        "processed",
        "retry_scheduled",
        "failed_retryable",
        "failed_permanent",
        "duplicate",
      ],
      default: "received",
      index: true,
    },
    attemptCount: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: null, index: true },
    lastAttemptAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    crmLeadId: { type: Schema.Types.ObjectId, ref: "Lead", default: null },
    fbLeadEntryId: { type: Schema.Types.ObjectId, ref: "FBLeadEntry", default: null },
    matchedCampaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", default: null },
    userEmail: { type: String, default: "", index: true },
    lastError: { type: String, default: "" },
    failureReason: { type: String, default: "" },
    deliveryCount: { type: Number, default: 1 },
  },
  { timestamps: true }
);

MetaLeadWebhookEventSchema.index({ processingStatus: 1, nextRetryAt: 1 });

export type MetaLeadWebhookEvent = InferSchemaType<typeof MetaLeadWebhookEventSchema>;

export default (models.MetaLeadWebhookEvent as mongoose.Model<MetaLeadWebhookEvent>) ||
  model<MetaLeadWebhookEvent>("MetaLeadWebhookEvent", MetaLeadWebhookEventSchema);
