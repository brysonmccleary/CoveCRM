// models/EmailCampaign.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const EmailCampaignStepSchema = new Schema(
  {
    day: { type: Number, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String, default: "" },
  },
  { _id: false }
);

const EmailCampaignSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    fromName: { type: String, default: "" },
    fromEmail: { type: String, default: "" },
    replyTo: { type: String, default: "" },
    // max emails to send per day across all enrollments for this campaign
    dailyLimit: { type: Number, default: 100 },
    steps: { type: [EmailCampaignStepSchema], default: [] },
  },
  { timestamps: true }
);

export type EmailCampaign = InferSchemaType<typeof EmailCampaignSchema>;
export default (models.EmailCampaign as mongoose.Model<EmailCampaign>) ||
  model<EmailCampaign>("EmailCampaign", EmailCampaignSchema);
