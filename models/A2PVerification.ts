import mongoose, { Schema, Document } from "mongoose";

export interface IA2PVerification extends Document {
  userEmail: string;
  brandSid: string;
  campaignSid: string;
  status: "pending" | "approved" | "rejected";
  lastChecked?: Date;
  optInScreenshotUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const A2PVerificationSchema = new Schema<IA2PVerification>(
  {
    userEmail: { type: String, required: true },
    brandSid: { type: String, required: true },
    campaignSid: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    lastChecked: { type: Date },
    optInScreenshotUrl: { type: String }, // ✅ NEW FIELD
  },
  { timestamps: true },
);

const A2PVerification =
  mongoose.models.A2PVerification ||
  mongoose.model<IA2PVerification>("A2PVerification", A2PVerificationSchema);

export default A2PVerification;
