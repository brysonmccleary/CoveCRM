import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const LeadInteractionEventSchema = new Schema(
  {
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    type: { type: String, required: true },
    direction: { type: String, default: "system" },
    body: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} },
    sourceId: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

LeadInteractionEventSchema.index({ userEmail: 1, leadId: 1, createdAt: -1 });

export type LeadInteractionEvent = InferSchemaType<typeof LeadInteractionEventSchema>;

export default (models.LeadInteractionEvent as mongoose.Model<LeadInteractionEvent>) ||
  model<LeadInteractionEvent>("LeadInteractionEvent", LeadInteractionEventSchema);
