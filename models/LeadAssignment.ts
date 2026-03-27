// models/LeadAssignment.ts
// Audit trail for every DOI lead assignment — one record per (doiLead, user) pair.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const LeadAssignmentSchema = new Schema(
  {
    doiLeadId: {
      type: Schema.Types.ObjectId,
      ref: "DOILead",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    assignedAt: { type: Date, default: () => new Date(), index: true },

    // CRM records created at assignment time
    folderId: { type: Schema.Types.ObjectId, ref: "Folder" },
    campaignId: { type: Schema.Types.ObjectId, ref: "EmailCampaign" },
    crmLeadId: { type: Schema.Types.ObjectId, ref: "Lead" },

    status: {
      type: String,
      enum: ["active", "completed", "unsubscribed", "bounced"],
      default: "active",
      index: true,
    },

    planId: { type: Schema.Types.ObjectId, ref: "ProspectingPlan", index: true },
  },
  { timestamps: true }
);

// Each DOI lead can only be assigned to the same user once (ever)
LeadAssignmentSchema.index({ doiLeadId: 1, userId: 1 }, { unique: true });
LeadAssignmentSchema.index({ userId: 1, assignedAt: -1 });
LeadAssignmentSchema.index({ planId: 1 });

export type LeadAssignment = InferSchemaType<typeof LeadAssignmentSchema>;
export default (models.LeadAssignment as mongoose.Model<LeadAssignment>) ||
  model<LeadAssignment>("LeadAssignment", LeadAssignmentSchema);
