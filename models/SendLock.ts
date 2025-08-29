import mongoose, { Schema, models, model } from "mongoose";

const SendLockSchema = new Schema(
  {
    scope: { type: String, required: true }, // e.g., 'drip' | 'ai' | 'blast'
    key:   { type: String, required: true }, // e.g., `${userEmail}:${leadId}:${campaignId}:${stepId}`
    ttlAt: { type: Date,   required: true }, // when this lock expires
  },
  { timestamps: true }
);

// One lock per (scope,key)
SendLockSchema.index({ scope: 1, key: 1 }, { unique: true });

// Auto-expire past ttlAt
SendLockSchema.index({ ttlAt: 1 }, { expireAfterSeconds: 0 });

export default (models.SendLock as mongoose.Model<any>) || model("SendLock", SendLockSchema);
