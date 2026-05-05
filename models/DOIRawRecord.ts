// models/DOIRawRecord.ts
// Raw staging record: every row landed from a DOI source before normalization/promotion.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const DOIRawRecordSchema = new Schema(
  {
    payloadHash: { type: String, index: true }, // SHA-256 of key fields for dedup
    source: { type: String, required: true, index: true }, // "FL-DOI", "TX-DOI", etc.
    state: { type: String, index: true },
    // Raw fields from source — stored as-is, no coercion
    rawFirstName: { type: String, default: "" },
    rawLastName: { type: String, default: "" },
    rawLicenseType: { type: String, default: "" },
    rawLineOfAuthority: { type: String, default: "" },
    rawLicenseStatus: { type: String, default: "" },
    rawLicenseNumber: { type: String, default: "" },
    rawNpn: { type: String, default: "" },
    rawEmail: { type: String, default: "" },
    rawPhone: { type: String, default: "" },
    rawCity: { type: String, default: "" },
    // Pipeline status + attempts
    parseStatus: {
      type: String,
      enum: [
        "pending",
        "normalizing",
        "normalized",
        "promotion_pending",
        "promoted",
        "rejected",
        "skipped",
        "failed",
      ],
      default: "pending",
      index: true,
    },
    normalizeAttempts: { type: Number, default: 0 },
    lastNormalizeAt: { type: Date },
    isRelevantLifeHealth: { type: Boolean, default: false },
    normalizeError: { type: String, default: "" },
    rejectionReason: { type: String, default: "" },
    promotionAttempts: { type: Number, default: 0 },
    lastPromotionAt: { type: Date },
    promotionError: { type: String, default: "" },
    // Promotion output
    promotedAgentId: { type: Schema.Types.ObjectId, ref: "DOIAgent" },
    promotedAt: { type: Date },
  },
  { timestamps: true }
);

DOIRawRecordSchema.index({ payloadHash: 1 }, { unique: true, sparse: true });
DOIRawRecordSchema.index({ source: 1, parseStatus: 1 });

export type DOIRawRecord = InferSchemaType<typeof DOIRawRecordSchema>;
export default (models.DOIRawRecord as mongoose.Model<DOIRawRecord>) ||
  model<DOIRawRecord>("DOIRawRecord", DOIRawRecordSchema);
