// /models/Message.ts
import mongoose, { Schema, Types } from "mongoose";

export type MessageDirection = "inbound" | "outbound" | "ai";

export interface IMessage {
  // Associations
  leadId: Types.ObjectId;
  userEmail: string;

  // Direction of the message in the conversation
  direction: MessageDirection;

  // Content + read state
  text: string;
  read?: boolean;

  // Twilio delivery + traceability
  sid?: string; // Twilio Message SID (SM...)
  status?: string; // queued | accepted | sending | sent | delivered | failed | undelivered | error | suppressed | scheduled
  errorCode?: string;
  errorMessage?: string;

  // Routing info
  to?: string;
  from?: string;
  fromServiceSid?: string;

  // Lifecycle timestamps
  queuedAt?: Date;
  scheduledAt?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;

  // Suppression/flags
  suppressed?: boolean;
  reason?: string; // "opt_out" | "scheduled_quiet_hours" | etc.

  // Added by { timestamps: true }
  createdAt?: Date;
  updatedAt?: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    leadId: {
      type: Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
      index: true,
    },
    userEmail: { type: String, required: true, index: true },

    direction: {
      type: String,
      enum: ["inbound", "outbound", "ai"],
      required: true,
    },

    text: { type: String, required: true },
    read: { type: Boolean, default: false },

    sid: { type: String },
    status: { type: String },
    errorCode: { type: String },
    errorMessage: { type: String },

    to: { type: String },
    from: { type: String },
    fromServiceSid: { type: String },

    queuedAt: { type: Date },
    scheduledAt: { type: Date },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    failedAt: { type: Date },

    suppressed: { type: Boolean, default: false },
    reason: { type: String },
  },
  { timestamps: true },
);

// Conversation fetch (most recent first)
MessageSchema.index(
  { userEmail: 1, leadId: 1, createdAt: -1 },
  { name: "conv_by_user_lead_createdAt" },
);

// Fast unread lookups within a lead's thread
MessageSchema.index(
  { userEmail: 1, leadId: 1, read: 1, createdAt: -1 },
  { name: "unread_by_user_lead" },
);

// Single, authoritative index for Twilio SIDs
MessageSchema.index(
  { sid: 1 },
  {
    name: "sid_unique_partial",
    unique: true,
    partialFilterExpression: { sid: { $exists: true, $type: "string" } },
  },
);

export type MessageModel = mongoose.Model<IMessage>;
export default (mongoose.models.Message as MessageModel) ||
  mongoose.model<IMessage>("Message", MessageSchema);
