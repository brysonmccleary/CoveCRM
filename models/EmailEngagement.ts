// models/EmailEngagement.ts
// Tracks engagement signals for DOI outreach emails.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const EmailEngagementSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: "DOIAgent", index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "EmailCampaign", index: true },
    opened: { type: Boolean, default: false },
    clicked: { type: Boolean, default: false },
    replied: { type: Boolean, default: false },
    unsubscribed: { type: Boolean, default: false },
    lastEngagementAt: { type: Date },
  },
  { timestamps: true }
);

EmailEngagementSchema.index({ agentId: 1, email: 1 }, { unique: true, sparse: true });

export type EmailEngagement = InferSchemaType<typeof EmailEngagementSchema>;
export default (models.EmailEngagement as mongoose.Model<EmailEngagement>) ||
  model<EmailEngagement>("EmailEngagement", EmailEngagementSchema);
