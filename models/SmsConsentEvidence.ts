import mongoose, { Schema, models } from "mongoose";

const SmsConsentEvidenceSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, index: true },
    flow: {
      type: String,
      enum: ["lead_generation", "servicing"],
      required: true,
      index: true,
    },

    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    phone: { type: String, required: true },
    email: { type: String, default: "" },

    consentGiven: { type: Boolean, required: true },
    consentText: { type: String, required: true },
    consentTextVersion: { type: String, required: true },

    pageUrl: { type: String, required: true },
    privacyUrl: { type: String, required: true },
    termsUrl: { type: String, required: true },

    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    submittedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

SmsConsentEvidenceSchema.index({ userId: 1, phone: 1, submittedAt: -1 });

export default models.SmsConsentEvidence ||
  mongoose.model("SmsConsentEvidence", SmsConsentEvidenceSchema);
