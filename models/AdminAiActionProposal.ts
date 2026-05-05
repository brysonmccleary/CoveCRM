import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const AdminAiActionProposalSchema = new Schema(
  {
    targetUserId: { type: String, required: true, index: true },
    targetUserEmail: { type: String, required: true, index: true },
    actionType: {
      type: String,
      required: true,
      index: true,
    },
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      required: true,
      default: "high",
    },
    title: { type: String, required: true },
    explanation: { type: String, required: true },
    proposedPayload: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["pending", "approved", "executed", "rejected", "failed"],
      default: "pending",
      index: true,
    },
    createdBy: { type: String, required: true, default: "system" },
    source: { type: String, required: true, default: "a2p_failure_detector", index: true },
    autoEligible: { type: Boolean, default: false, index: true },
    confidence: { type: Number, default: 0 },
    executionResult: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true }
);

AdminAiActionProposalSchema.index({
  targetUserId: 1,
  actionType: 1,
  source: 1,
  status: 1,
});

export type AdminAiActionProposal = InferSchemaType<typeof AdminAiActionProposalSchema>;

export default (models.AdminAiActionProposal as mongoose.Model<AdminAiActionProposal>) ||
  model<AdminAiActionProposal>("AdminAiActionProposal", AdminAiActionProposalSchema);
