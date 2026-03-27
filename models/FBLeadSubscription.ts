// models/FBLeadSubscription.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const FBLeadSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true, unique: true },
    plan: {
      type: String,
      enum: ["manager", "manager_pro"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "cancelled", "trialing"],
      default: "trialing",
      index: true,
    },
    stripeSubscriptionId: { type: String },
    currentPeriodEnd: { type: Date },
  },
  { timestamps: true }
);

export type FBLeadSubscription = InferSchemaType<typeof FBLeadSubscriptionSchema>;
export default (models.FBLeadSubscription as mongoose.Model<FBLeadSubscription>) ||
  model<FBLeadSubscription>("FBLeadSubscription", FBLeadSubscriptionSchema);
