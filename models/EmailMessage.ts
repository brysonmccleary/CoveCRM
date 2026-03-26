// models/EmailMessage.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const EmailMessageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    to: { type: String, required: true },
    from: { type: String, required: true },
    replyTo: { type: String, default: "" },
    subject: { type: String, required: true },
    html: { type: String, default: "" },
    text: { type: String, default: "" },
    direction: {
      type: String,
      enum: ["outbound", "inbound"],
      default: "outbound",
    },
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "opened", "bounced", "replied", "failed"],
      default: "queued",
      index: true,
    },
    resendId: { type: String, default: "", sparse: true },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "EmailCampaign",
      index: true,
      sparse: true,
    },
    enrollmentId: {
      type: Schema.Types.ObjectId,
      ref: "ProspectRecord",
      index: true,
      sparse: true,
    },
    stepIndex: { type: Number },
    sentAt: { type: Date, index: true },
    openedAt: { type: Date },
    repliedAt: { type: Date },
  },
  { timestamps: true }
);

EmailMessageSchema.index({ leadId: 1, sentAt: -1 });
EmailMessageSchema.index({ userEmail: 1, leadId: 1 });
EmailMessageSchema.index({ userEmail: 1, campaignId: 1, sentAt: 1 });
EmailMessageSchema.index({ resendId: 1 }, { sparse: true });

export type EmailMessage = InferSchemaType<typeof EmailMessageSchema>;
export default (models.EmailMessage as mongoose.Model<EmailMessage>) ||
  model<EmailMessage>("EmailMessage", EmailMessageSchema);
