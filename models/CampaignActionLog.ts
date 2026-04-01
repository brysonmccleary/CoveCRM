import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const CampaignActionLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", required: true, index: true },
    actionType: {
      type: String,
      enum: ["PAUSE", "SCALE", "FIX", "DUPLICATE_TEST"],
      required: true,
      index: true,
    },
    oldBudget: { type: Number, default: 0 },
    newBudget: { type: Number, default: 0 },
    metaResponse: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

CampaignActionLogSchema.index({ campaignId: 1, createdAt: -1 });
CampaignActionLogSchema.index({ userId: 1, createdAt: -1 });

export type CampaignActionLog = InferSchemaType<typeof CampaignActionLogSchema>;
export default (models.CampaignActionLog as mongoose.Model<CampaignActionLog>) ||
  model<CampaignActionLog>("CampaignActionLog", CampaignActionLogSchema);
