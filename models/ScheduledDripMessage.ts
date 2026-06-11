// models/ScheduledDripMessage.ts
//
// V2 drip scheduling: one document per step per enrollment.
// The worker (send-drip-messages) ONLY processes these records —
// it never scans DripEnrollment or campaigns to decide who is due.
// Cron frequency ≠ text frequency: cron runs every minute but only
// sends messages whose sendAt has arrived and whose status is "pending".

import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const ScheduledDripMessageSchema = new Schema(
  {
    // Tenant scope
    userEmail: { type: String, required: true, index: true },

    // Identity
    leadId: { type: Schema.Types.ObjectId, required: true, ref: "Lead", index: true },
    campaignId: { type: Schema.Types.ObjectId, required: true, ref: "DripCampaign", index: true },
    enrollmentId: { type: Schema.Types.ObjectId, required: true, ref: "DripEnrollment", index: true },

    // Step identity (both stored for audit; stepIndex is used for compound uniqueness)
    stepId: { type: String, required: true },    // stringified step._id from campaign
    stepIndex: { type: Number, required: true }, // 0-based index in campaign.steps

    // Message — snapshot taken at enrollment time (template already rendered)
    bodySnapshot: { type: String, required: true },
    toNumber: { type: String, required: true },  // E.164 lead phone

    // Scheduling
    sendAt: { type: Date, required: true },
    timezone: { type: String, default: "America/New_York" }, // lead-local tz at enrollment

    // Delay info (stored for display/debug; sendAt is the authoritative time)
    delayValue: { type: Number },
    delayUnit: { type: String, enum: ["hours", "days", "weeks", "months"] },

    // Lifecycle
    status: {
      type: String,
      enum: ["pending", "sending", "sent", "canceled", "skipped", "failed"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },

    // Atomic claim fields
    processingAt: { type: Date },
    lockedAt: { type: Date },

    // Outcome timestamps
    sentAt: { type: Date },
    skippedAt: { type: Date },
    canceledAt: { type: Date },

    // Outcome details
    cancelReason: { type: String },
    failReason: { type: String },
    messageSid: { type: String },

    // Idempotency: "sdm:{enrollmentId}:{stepIndex}"
    idempotencyKey: { type: String },
  },
  { timestamps: true }
);

// ── Indexes ──────────────────────────────────────────────────────────────────

// Primary worker query: find due pending records
ScheduledDripMessageSchema.index({ status: 1, sendAt: 1 });

// Uniqueness: one record per enrollment step (prevents double-registration)
ScheduledDripMessageSchema.index(
  { enrollmentId: 1, stepIndex: 1 },
  { unique: true }
);

// Idempotency key (unique, sparse so null rows don't conflict)
ScheduledDripMessageSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $exists: true, $type: "string" },
    },
  }
);

// Cancel-on-opt-out: find all pending for a lead
ScheduledDripMessageSchema.index({ leadId: 1, status: 1 });

// Per-user admin / monitoring queries
ScheduledDripMessageSchema.index({ userEmail: 1, status: 1, sendAt: 1 });

// Campaign admin
ScheduledDripMessageSchema.index({ campaignId: 1, status: 1 });

// ─────────────────────────────────────────────────────────────────────────────

export type ScheduledDripMessageDoc = InferSchemaType<typeof ScheduledDripMessageSchema>;

export default (models.ScheduledDripMessage as mongoose.Model<ScheduledDripMessageDoc>) ||
  model<ScheduledDripMessageDoc>("ScheduledDripMessage", ScheduledDripMessageSchema);
