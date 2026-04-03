// models/DOIOutcome.ts
// Tracks downstream outcomes for DOI agents to create feedback loops.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const DOIOutcomeSchema = new Schema(
  {
    agentId: { type: Schema.Types.ObjectId, ref: "DOIAgent", required: true, index: true },
    email: { type: String, default: "", lowercase: true, trim: true },
    doiLeadId: { type: Schema.Types.ObjectId, ref: "DOILead" },
    eventType: {
      type: String,
      enum: ["promoted", "bounced", "replied", "opened", "manual_reject", "manual_approve"],
      required: true,
      index: true,
    },
    eventSource: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

DOIOutcomeSchema.index({ agentId: 1, eventType: 1, createdAt: -1 });

export type DOIOutcome = InferSchemaType<typeof DOIOutcomeSchema>;
export default (models.DOIOutcome as mongoose.Model<DOIOutcome>) ||
  model<DOIOutcome>("DOIOutcome", DOIOutcomeSchema);
