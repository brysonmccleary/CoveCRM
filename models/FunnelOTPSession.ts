import mongoose from "mongoose";

const FunnelOTPSessionSchema = new mongoose.Schema({
  campaignId: { type: String, required: true, index: true },
  phoneLast10: { type: String, required: true },
  codeHash: { type: String, required: true },
  verified: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  createdAt: { type: Date, default: Date.now },
});

FunnelOTPSessionSchema.index({ campaignId: 1, phoneLast10: 1, createdAt: 1 });

export default mongoose.models.FunnelOTPSession ||
  mongoose.model("FunnelOTPSession", FunnelOTPSessionSchema);
