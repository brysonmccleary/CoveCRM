import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const SupportMessageSchema = new Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SupportConversationSchema = new Schema(
  {
    userEmail: { type: String, required: true, index: true },
    messages: { type: [SupportMessageSchema], default: [] },
  },
  { timestamps: true }
);

SupportConversationSchema.index({ userEmail: 1, updatedAt: -1 });

export type SupportConversation = InferSchemaType<typeof SupportConversationSchema>;

export default (models.SupportConversation as mongoose.Model<SupportConversation>) ||
  model<SupportConversation>("SupportConversation", SupportConversationSchema);
