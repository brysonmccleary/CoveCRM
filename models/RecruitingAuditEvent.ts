import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const RecruitingAuditEventSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
    actorEmail: { type: String, required: true, lowercase: true, immutable: true },
    eventType: {
      type: String,
      enum: [
        "campaign_created",
        "campaign_updated",
        "action_simulated",
        "action_blocked",
        "companion_pairing_created",
        "companion_paired",
        "companion_paused",
        "companion_resumed",
        "action_queued",
        "action_claimed",
        "action_completed",
        "action_skipped",
        "action_failed",
        "cloud_account_connecting",
        "cloud_account_connected",
        "cloud_account_reauth_required",
        "cloud_account_paused",
        "cloud_account_resumed",
        "cloud_account_canceled",
        "cloud_worker_started",
        "cloud_worker_finished",
        "discovery_qualification_failed",
        "automation_alert_sent",
      ],
      required: true,
      index: true,
      immutable: true,
    },
    entityType: { type: String, required: true, immutable: true },
    entityId: { type: String, required: true, index: true, immutable: true },
    details: { type: Schema.Types.Mixed, default: {}, immutable: true },
    occurredAt: { type: Date, default: Date.now, index: true, immutable: true },
  },
  { timestamps: false },
);

RecruitingAuditEventSchema.index({ ownerEmail: 1, occurredAt: -1 });
RecruitingAuditEventSchema.index(
  { ownerEmail: 1, eventType: 1, entityId: 1 },
  { unique: true },
);

export type RecruitingAuditEvent = InferSchemaType<typeof RecruitingAuditEventSchema>;
export default (models.RecruitingAuditEvent as mongoose.Model<RecruitingAuditEvent>) ||
  model<RecruitingAuditEvent>("RecruitingAuditEvent", RecruitingAuditEventSchema);
