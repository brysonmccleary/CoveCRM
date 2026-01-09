// /models/LeadAIState.ts
import mongoose, { Schema, Document, Model } from "mongoose";

export interface ILeadAIState extends Document {
  leadId: mongoose.Types.ObjectId;
  userEmail: string;

  phoneLast10?: string;

  lastHumanOutboundAt?: Date | null;
  lastLeadInboundAt?: Date | null;

  // If set, AI must not proactively send unless lead replies.
  aiSuppressedUntil?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const LeadAIStateSchema = new Schema<ILeadAIState>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    userEmail: { type: String, required: true, index: true },

    phoneLast10: { type: String, default: "" },

    lastHumanOutboundAt: { type: Date, default: null },
    lastLeadInboundAt: { type: Date, default: null },
    aiSuppressedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

LeadAIStateSchema.index({ userEmail: 1, leadId: 1 }, { unique: true });

export const LeadAIState: Model<ILeadAIState> =
  (mongoose.models.LeadAIState as Model<ILeadAIState>) ||
  mongoose.model<ILeadAIState>("LeadAIState", LeadAIStateSchema);
