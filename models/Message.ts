// models/Message.ts
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
  status?: string; // queued | sent | delivered | failed | undelivered | etc.
  errorCode?: string; // e.g. 30034, 30007

  // Routing info
  to?: string; // E.164 destination
  from?: string; // Specific number if used (rare)
  fromServiceSid?: string; // Messaging Service SID (MG...)

  // Timestamps
  sentAt?: Date; // when we attempted to send

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

    // ⚠️ Removed inline index on `sid` to avoid duplicate with schema-level index
    sid: { type: String },
    status: { type: String },
    errorCode: { type: String },

    to: { type: String },
    from: { type: String },
    fromServiceSid: { type: String },

    sentAt: { type: Date },
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
// - unique only when `sid` exists & is a string
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
