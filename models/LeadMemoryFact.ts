import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const LeadMemoryFactSchema = new Schema(
  {
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    key: { type: String, required: true, index: true },
    value: { type: String, default: "" },
    confidence: { type: Number, default: 0 },
    sourceEventId: { type: Schema.Types.ObjectId, ref: "LeadInteractionEvent" },
    status: {
      type: String,
      enum: ["active", "stale", "contradicted"],
      default: "active",
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

LeadMemoryFactSchema.index({ userEmail: 1, leadId: 1 });
LeadMemoryFactSchema.index({ userEmail: 1, leadId: 1, key: 1 });

export type LeadMemoryFact = InferSchemaType<typeof LeadMemoryFactSchema>;

export default (models.LeadMemoryFact as mongoose.Model<LeadMemoryFact>) ||
  model<LeadMemoryFact>("LeadMemoryFact", LeadMemoryFactSchema);
