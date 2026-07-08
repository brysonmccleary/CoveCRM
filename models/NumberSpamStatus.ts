// models/NumberSpamStatus.ts
import mongoose, { Schema, models, model } from "mongoose";

const NumberSpamStatusSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    spamScore: { type: Number, default: 0 }, // 0-100
    spamLabel: { type: String, default: "" }, // e.g. "Spam Risk", "Scam Likely"
    isSpam: { type: Boolean, default: false },
    tier: { type: String, enum: ["insufficient_data", "healthy", "watch", "spam_risk"], default: "healthy", index: true },
    answerRate: { type: Number, default: null },
    priorAnswerRate: { type: Number, default: null },
    shortCallRate: { type: Number, default: null },
    peerMedian: { type: Number, default: null },
    dials7d: { type: Number, default: 0 },
    reasons: { type: [String], default: [] },
    flaggedAt: { type: Date, default: null },
    clearedAt: { type: Date, default: null },
    lastAlertedAt: { type: Date, default: null },
    lastAlertTier: { type: String, default: "" },
    checkedAt: { type: Date, default: Date.now },
    rawResponse: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

NumberSpamStatusSchema.index(
  { userEmail: 1, phoneNumber: 1 },
  { unique: true, name: "number_spam_status_user_phone_unique" },
);

export default models.NumberSpamStatus || model("NumberSpamStatus", NumberSpamStatusSchema);
