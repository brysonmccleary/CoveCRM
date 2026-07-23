import mongoose, { Schema, models } from "mongoose";

const MetaCAPIEventSchema = new Schema(
  {
    userEmail: { type: String, required: true, index: true, immutable: true },
    datasetId: { type: String, required: true, immutable: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", index: true, immutable: true },
    eventId: { type: String, required: true, immutable: true },
    eventName: { type: String, required: true, immutable: true },
    payload: { type: Schema.Types.Mixed, required: true, immutable: true },
    status: {
      type: String,
      enum: ["pending", "processing", "sent", "failed", "capped"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    claimedAt: { type: Date, default: null },
    claimToken: { type: String, default: "" },
    sentAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
  },
  { timestamps: true }
);

MetaCAPIEventSchema.index({ userEmail: 1, eventId: 1, eventName: 1 }, { unique: true });
MetaCAPIEventSchema.index({ userEmail: 1, status: 1, nextAttemptAt: 1 });
MetaCAPIEventSchema.index({ userEmail: 1, status: 1, eventName: 1, sentAt: -1 });

export default models.MetaCAPIEvent || mongoose.model("MetaCAPIEvent", MetaCAPIEventSchema);
