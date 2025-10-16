// models/Message.ts
import mongoose, { Schema, Types } from "mongoose";

export type MessageDirection = "inbound" | "outbound" | "ai";

export interface IMessage {
  leadId: Types.ObjectId;
  userEmail: string;

  direction: MessageDirection;
  text: string;
  read?: boolean;
  kind?: string;

  // Twilio
  sid?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;

  to?: string;
  from?: string;
  fromServiceSid?: string;

  queuedAt?: Date;
  scheduledAt?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;

  suppressed?: boolean;
  reason?: string;

  // Idempotency / drip metadata
  enrollmentId?: Types.ObjectId | string;
  campaignId?: Types.ObjectId | string;
  stepIndex?: number;
  idempotencyKey?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    userEmail: { type: String, required: true, index: true },

    direction: { type: String, enum: ["inbound", "outbound", "ai"], required: true },
    text: { type: String, required: true },
    read: { type: Boolean, default: false },

    kind: { type: String },

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

    enrollmentId: { type: Schema.Types.Mixed, index: true },
    campaignId: { type: Schema.Types.Mixed, index: true },
    stepIndex: { type: Number },
    idempotencyKey: { type: String }, // UNIQUE (partial)
  },
  { timestamps: true }
);

// Conversation fetches
MessageSchema.index({ userEmail: 1, leadId: 1, createdAt: -1 });
MessageSchema.index({ userEmail: 1, leadId: 1, read: 1, createdAt: -1 });
MessageSchema.index({ userEmail: 1, createdAt: -1 });
MessageSchema.index({ userEmail: 1, kind: 1, direction: 1, status: 1, createdAt: -1 });
MessageSchema.index({ userEmail: 1, from: 1, to: 1, createdAt: -1 });

// Unique Twilio SID
MessageSchema.index({ sid: 1 }, {
  unique: true,
  partialFilterExpression: { sid: { $exists: true, $type: "string" } },
});

// Idempotency — prevents duplicate drip sends
MessageSchema.index({ idempotencyKey: 1 }, {
  unique: true,
  partialFilterExpression: { idempotencyKey: { $exists: true, $type: "string" } },
});

export type MessageModel = mongoose.Model<IMessage>;
export default (mongoose.models.Message as MessageModel) ||
  mongoose.model<IMessage>("Message", MessageSchema);
