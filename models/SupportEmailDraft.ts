import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const SupportEmailDraftSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    to: { type: String, required: true, index: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    source: {
      type: String,
      required: true,
      default: "a2p_failure",
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "queued", "sent", "discarded"],
      default: "draft",
      index: true,
    },
    relatedProposalId: { type: String, index: true },
    autoEligible: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

SupportEmailDraftSchema.index({ source: 1, status: 1, createdAt: -1 });

export type SupportEmailDraft = InferSchemaType<typeof SupportEmailDraftSchema>;

export default (models.SupportEmailDraft as mongoose.Model<SupportEmailDraft>) ||
  model<SupportEmailDraft>("SupportEmailDraft", SupportEmailDraftSchema);
