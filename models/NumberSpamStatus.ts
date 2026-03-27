// models/NumberSpamStatus.ts
import mongoose, { Schema, models, model } from "mongoose";

const NumberSpamStatusSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, unique: true },
    userEmail: { type: String, required: true, index: true },
    spamScore: { type: Number, default: 0 }, // 0-100
    spamLabel: { type: String, default: "" }, // e.g. "Spam Risk", "Scam Likely"
    isSpam: { type: Boolean, default: false },
    checkedAt: { type: Date, default: Date.now },
    rawResponse: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default models.NumberSpamStatus || model("NumberSpamStatus", NumberSpamStatusSchema);
