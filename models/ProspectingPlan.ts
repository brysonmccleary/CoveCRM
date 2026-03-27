// models/ProspectingPlan.ts
// Tracks each user's active prospecting subscription and lead usage.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const ProspectingPlanSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    planTier: {
      type: Number,
      enum: [250, 500, 1000, 2500],
      required: true,
    },
    leadsIncluded: { type: Number, required: true },
    leadsAssigned: { type: Number, default: 0 },
    leadsRemaining: { type: Number, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "expired", "cancelled"],
      default: "active",
      index: true,
    },
    stripeSubscriptionId: { type: String, index: true, sparse: true },
    stripeProductId: { type: String, default: "" },
    autoRenew: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ProspectingPlanSchema.index({ userId: 1, status: 1 });
ProspectingPlanSchema.index({ stripeSubscriptionId: 1 }, { sparse: true });

export type ProspectingPlan = InferSchemaType<typeof ProspectingPlanSchema>;
export default (models.ProspectingPlan as mongoose.Model<ProspectingPlan>) ||
  model<ProspectingPlan>("ProspectingPlan", ProspectingPlanSchema);
