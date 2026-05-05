// models/EmailVerification.ts
// Tracks every generated/verified email candidate for DOI agents.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const EmailVerificationSchema = new Schema(
  {
    agentId: { type: Schema.Types.ObjectId, ref: "DOIAgent", required: true, index: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    emailType: {
      type: String,
      enum: ["domain", "personal", "work", ""],
      default: "work",
      index: true,
    },
    patternUsed: { type: String, default: "" },
    smtpValid: { type: Boolean, default: false, index: true },
    confidenceScore: { type: Number, default: 0 },
    verificationStatus: {
      type: String,
      enum: [
        "pending",
        "valid",
        "invalid",
        "bounced",
        "catch_all_suspected",
        "no_mx",
        "timeout",
        "temp_failure",
        "blocked",
        "error",
      ],
      default: "pending",
      index: true,
    },
    smtpCode: { type: Number, default: null },
    smtpReason: { type: String, default: "" },
    mxHost: { type: String, default: "" },
    catchAllSuspected: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    verifiedAt: { type: Date },
    reasonBucket: { type: String, default: "" },
    rejectionReason: { type: String, default: "" },
    manualDecision: {
      type: String,
      enum: ["", "approved", "rejected"],
      default: "",
      index: true,
    },
    manualNotes: { type: String, default: "" },
  },
  { timestamps: true }
);

EmailVerificationSchema.index({ agentId: 1, email: 1 }, { unique: true });

export type EmailVerification = InferSchemaType<typeof EmailVerificationSchema>;
export default (models.EmailVerification as mongoose.Model<EmailVerification>) ||
  model<EmailVerification>("EmailVerification", EmailVerificationSchema);
