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

  // Optional kind (e.g., "call" for voice events you record as Message docs)
  kind?: string;

  // Twilio delivery + traceability
  sid?: string; // Twilio Message SID (SM...)
  status?: string; // queued | accepted | sending | sent | delivered | failed | undelivered | error | suppressed | scheduled | answered | completed | connected
  errorCode?: string;
  errorMessage?: string;

  // Routing info
  to?: string;
  from?: string;
  fromServiceSid?: string;
  accountSid?: string;
  numMedia?: number;

  // Lifecycle timestamps
  queuedAt?: Date;
  scheduledAt?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;

  // Suppression/flags
  suppressed?: boolean;
  reason?: string; // "opt_out" | "scheduled_quiet_hours" | etc.

  // Idempotency & lightweight dedupe
  idempotencyKey?: string;
  contentHash?: string;

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

    // Optional "kind" so we can tag call attempts/records and aggregate fast
    kind: { type: String },

    sid: { type: String },
    status: { type: String },
    errorCode: { type: String },
    errorMessage: { type: String },

    to: { type: String },
    from: { type: String },
    fromServiceSid: { type: String },
    accountSid: { type: String },
    numMedia: { type: Number },

    queuedAt: { type: Date },
    scheduledAt: { type: Date },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    failedAt: { type: Date },

    suppressed: { type: Boolean, default: false },
    reason: { type: String },

    // Idempotency & dedupe
    idempotencyKey: { type: String },
    contentHash: { type: String },
  },
  { timestamps: true },
);

/** 🔎 Indexes (no explicit names to avoid future name conflicts)
 * - userEmail + leadId + createdAt: fast thread fetch (recency)
 * - userEmail + leadId + read + createdAt: fast unread checks
 * - userEmail + createdAt: generic listing by recency
 * - userEmail + kind + direction + status + createdAt: dashboard aggregates
 * - userEmail + from + to + createdAt: delivery/debug lookups
 * - sid (unique + partial): prevent duplicate Twilio SIDs
 * - idempotencyKey (unique + partial): enforce one-and-only-once per provided key
 * - userEmail + direction + to + text + createdAt: quick recent duplicate checks
 */

// Conversation fetch (most recent first)
MessageSchema.index({ userEmail: 1, leadId: 1, createdAt: -1 });

// Fast unread lookups within a lead's thread
MessageSchema.index({ userEmail: 1, leadId: 1, read: 1, createdAt: -1 });

// Generic listing by user and recency
MessageSchema.index({ userEmail: 1, createdAt: -1 });

// Dashboard: dials & talks (if you log calls into Message with kind="call")
MessageSchema.index({ userEmail: 1, kind: 1, direction: 1, status: 1, createdAt: -1 });

// Useful for delivery debugging
MessageSchema.index({ userEmail: 1, from: 1, to: 1, createdAt: -1 });

// Single, authoritative index for Twilio SIDs
MessageSchema.index(
  { sid: 1 },
  {
    unique: true,
    partialFilterExpression: { sid: { $exists: true, $type: "string" } },
  },
);

// 🔒 Idempotency (unique only when present)
MessageSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $exists: true, $type: "string" } },
  },
);

// Useful for duplicate-drip detection windows
MessageSchema.index({ userEmail: 1, direction: 1, to: 1, text: 1, createdAt: -1 });

export type MessageModel = mongoose.Model<IMessage>;
export default (mongoose.models.Message as MessageModel) ||
  mongoose.model<IMessage>("Message", MessageSchema);
