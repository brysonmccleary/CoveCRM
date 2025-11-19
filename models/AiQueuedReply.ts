// /models/AiQueuedReply.ts
import mongoose, { Schema, Document, Model } from "mongoose";

export interface IAiQueuedReply extends Document {
  leadId: mongoose.Types.ObjectId;
  userEmail: string;
  to: string;
  body: string;
  sendAfter: Date;
  createdAt: Date;
  updatedAt: Date;
  status: "queued" | "sending" | "sent" | "failed";
  failReason?: string;
  attempts: number;
}

const AiQueuedReplySchema = new Schema<IAiQueuedReply>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true },
    userEmail: { type: String, required: true, index: true },
    to: { type: String, required: true },
    body: { type: String, required: true },
    sendAfter: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ["queued", "sending", "sent", "failed"],
      default: "queued",
      index: true,
    },
    failReason: { type: String },
    attempts: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

export const AiQueuedReply: Model<IAiQueuedReply> =
  (mongoose.models.AiQueuedReply as Model<IAiQueuedReply>) ||
  mongoose.model<IAiQueuedReply>("AiQueuedReply", AiQueuedReplySchema);
