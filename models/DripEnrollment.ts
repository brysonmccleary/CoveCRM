// models/DripEnrollment.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const DripEnrollmentSchema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "Lead" },
    campaignId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "DripCampaign" },
    userEmail: { type: String, required: true, index: true }, // tenant scope

    status: {
      type: String,
      enum: ["active", "paused", "completed", "error", "canceled"],
      default: "active",
      index: true,
    },

    // Step tracking
    cursorStep: { type: Number, default: 0 }, // next step index to send
    nextSendAt: { type: Date, index: true },
    startedAt: { type: Date, default: () => new Date() },
    lastSentAt: { type: Date },

    // Safety flags (all honored by cron)
    active: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    enabled: { type: Boolean, default: true },
    paused: { type: Boolean, default: false },
    isPaused: { type: Boolean, default: false },
    stopAll: { type: Boolean, default: false },

    // Atomic claim to prevent double processing
    processing: { type: Boolean, default: false, index: true },
    processingAt: { type: Date },

    // Metadata
    source: {
      type: String,
      enum: ["manual-lead", "folder-bulk", "sheet-bulk"],
      default: "manual-lead",
      index: true,
    },
    lastError: { type: String },
  },
  { timestamps: true }
);

// ✅ Unique active/paused enrollment PER TENANT for (leadId, campaignId)
DripEnrollmentSchema.index(
  { userEmail: 1, leadId: 1, campaignId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["active", "paused"] } },
  }
);

// Fast scan for due items that are actually sendable
DripEnrollmentSchema.index(
  { status: 1, nextSendAt: 1, paused: 1, isPaused: 1, stopAll: 1 },
  { partialFilterExpression: { status: "active" } }
);

// Helpful compound
DripEnrollmentSchema.index({ userEmail: 1, leadId: 1, campaignId: 1 });

export type DripEnrollment = InferSchemaType<typeof DripEnrollmentSchema>;
export default (models.DripEnrollment as mongoose.Model<DripEnrollment>) ||
  model<DripEnrollment>("DripEnrollment", DripEnrollmentSchema);
