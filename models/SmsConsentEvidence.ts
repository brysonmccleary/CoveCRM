import mongoose, { Schema, models } from "mongoose";

const SmsConsentEvidenceSchema = new Schema(
  {
    userId: { type: String, required: true, index: true, immutable: true },
    userEmail: { type: String, index: true, immutable: true },
    flow: {
      type: String,
      enum: ["lead_generation", "servicing"],
      required: true,
      index: true,
      immutable: true,
    },

    firstName: { type: String, default: "", immutable: true },
    lastName: { type: String, default: "", immutable: true },
    phone: { type: String, required: true, immutable: true },
    email: { type: String, default: "", immutable: true },

    consentGiven: { type: Boolean, required: true, immutable: true },
    consentText: { type: String, required: true, immutable: true },
    consentTextVersion: { type: String, required: true, immutable: true },

    pageUrl: { type: String, required: true, immutable: true },
    privacyUrl: { type: String, required: true, immutable: true },
    termsUrl: { type: String, required: true, immutable: true },

    ip: { type: String, default: "", immutable: true },
    userAgent: { type: String, default: "", immutable: true },
    submittedAt: { type: Date, default: Date.now, index: true, immutable: true },
  },
  { timestamps: true },
);

SmsConsentEvidenceSchema.index({ userId: 1, phone: 1, submittedAt: -1 });

export default models.SmsConsentEvidence ||
  mongoose.model("SmsConsentEvidence", SmsConsentEvidenceSchema);
