import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const AdminAiAuditLogSchema = new Schema(
  {
    userId: { type: String, index: true },
    userEmail: { type: String, index: true },
    adminEmail: { type: String },
    source: { type: String, default: "a2p_failure_detector", index: true },
    taskType: { type: String, index: true },
    provider: { type: String },
    inputSummary: { type: String },
    outputSummary: { type: String },
    proposedActions: { type: [Schema.Types.Mixed], default: undefined },
    status: { type: String, default: "ok", index: true },
    error: { type: String },
    targetUserId: { type: String, index: true },
    targetUserEmail: { type: String, index: true },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

AdminAiAuditLogSchema.index({ targetUserId: 1, eventType: 1, createdAt: -1 });

export type AdminAiAuditLog = InferSchemaType<typeof AdminAiAuditLogSchema>;

export default (models.AdminAiAuditLog as mongoose.Model<AdminAiAuditLog>) ||
  model<AdminAiAuditLog>("AdminAiAuditLog", AdminAiAuditLogSchema);
