// models/FollowUpNudge.ts
import mongoose, { Schema, models, model } from "mongoose";

const FollowUpNudgeSchema = new Schema(
  {
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: false },
    campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign" },
    leadName: { type: String, default: "" },
    message: { type: String, required: true },
    priority: { type: String, enum: ["high", "medium", "low"], default: "medium" },
    dismissed: { type: Boolean, default: false },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

FollowUpNudgeSchema.index({ userEmail: 1, dismissed: 1, generatedAt: -1 });

export default models.FollowUpNudge || model("FollowUpNudge", FollowUpNudgeSchema);
