// models/ProspectRecord.ts
// Email campaign enrollment — mirrors DripEnrollment but for email campaigns.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const ProspectRecordSchema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "EmailCampaign",
      required: true,
      index: true,
    },
    // cached at enroll time so cron does not need to re-derive from lead fields
    leadEmail: { type: String, required: true },

    status: {
      type: String,
      enum: ["active", "paused", "completed", "error", "canceled"],
      default: "active",
      index: true,
    },

    // Step tracking (same pattern as DripEnrollment)
    cursorStep: { type: Number, default: 0 },
    nextSendAt: { type: Date, index: true },
    startedAt: { type: Date, default: () => new Date() },
    lastSentAt: { type: Date },

    // Durable once-only markers: key = step index string, value = Date sent
    sentAtByIndex: { type: Map, of: Date, default: undefined },

    // Pause / stop controls
    stopOnReply: { type: Boolean, default: true },
    paused: { type: Boolean, default: false },
    stopAll: { type: Boolean, default: false },

    // Atomic claim to prevent double-send in cron
    processing: { type: Boolean, default: false, index: true },
    processingAt: { type: Date },

    lastError: { type: String },
  },
  { timestamps: true }
);

// One active/paused enrollment per lead+campaign
ProspectRecordSchema.index(
  { leadId: 1, campaignId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["active", "paused"] } },
  }
);

// Fast cron scan
ProspectRecordSchema.index(
  { status: 1, nextSendAt: 1, processing: 1 },
  { partialFilterExpression: { status: "active" } }
);

ProspectRecordSchema.index({ userEmail: 1, leadId: 1, campaignId: 1 });

export type ProspectRecord = InferSchemaType<typeof ProspectRecordSchema>;
export default (models.ProspectRecord as mongoose.Model<ProspectRecord>) ||
  model<ProspectRecord>("ProspectRecord", ProspectRecordSchema);
