// models/DripEnrollment.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const DripEnrollmentSchema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "Lead" },
    campaignId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "DripCampaign" },
    userEmail: { type: String, required: true, index: true }, // owner/tenant scope

    status: {
      type: String,
      enum: ["active", "paused", "completed", "error"],
      default: "active",
      index: true,
    },

    cursorStep: { type: Number, default: 0 },                // next step index to send
    nextSendAt: { type: Date },                               // scheduler will pick this up
    source: {
      type: String,
      enum: ["manual-lead", "folder-bulk", "sheet-bulk"],
      default: "manual-lead",
      index: true,
    },

    // Optional diagnostics
    lastError: { type: String },
  },
  { timestamps: true }
);

// Unique active enrollment per (leadId, campaignId, status in active|paused)
DripEnrollmentSchema.index(
  { leadId: 1, campaignId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["active", "paused"] } } }
);

export type DripEnrollment = InferSchemaType<typeof DripEnrollmentSchema>;

export default (models.DripEnrollment as mongoose.Model<DripEnrollment>) ||
  model<DripEnrollment>("DripEnrollment", DripEnrollmentSchema);
