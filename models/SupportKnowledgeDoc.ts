import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const SupportKnowledgeDocSchema = new Schema(
  {
    title: { type: String, required: true },
    category: { type: String, default: "" },
    content: { type: String, required: true },
    tags: { type: [String], default: [] },
  },
  { timestamps: true }
);

SupportKnowledgeDocSchema.index({ category: 1, updatedAt: -1 });
SupportKnowledgeDocSchema.index({ tags: 1 });

export type SupportKnowledgeDoc = InferSchemaType<typeof SupportKnowledgeDocSchema>;

export default (models.SupportKnowledgeDoc as mongoose.Model<SupportKnowledgeDoc>) ||
  model<SupportKnowledgeDoc>("SupportKnowledgeDoc", SupportKnowledgeDocSchema);
