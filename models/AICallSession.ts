// models/AICallSession.ts
import mongoose, { Schema, Document, Model } from "mongoose";

export type AICallSessionStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "stopped"
  | "failed"
  | "error";

export interface IAICallSessionStats {
  completed: number;
  booked: number;
  not_interested: number;
  no_answer: number;
  callback: number;
  do_not_call: number;
  disconnected: number;
}

export interface IAICallSession extends Document {
  userEmail: string;
  userId?: mongoose.Types.ObjectId | null; // optional for now
  folderId: mongoose.Types.ObjectId;
  leadIds: mongoose.Types.ObjectId[];
  fromNumber: string;
  scriptKey: string;
  voiceKey: string;
  total: number;
  lastIndex: number;
  status: AICallSessionStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
  stats?: IAICallSessionStats;

  // ✅ Guardrail to prevent duplicate “kick worker” loops from Twilio retries
  chainKickedAt?: Date | null;
  chainKickCallSid?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const AICallSessionSchema = new Schema<IAICallSession>(
  {
    userEmail: { type: String, required: true, index: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
      index: true,
    },
    folderId: {
      type: Schema.Types.ObjectId,
      ref: "Folder",
      required: true,
      index: true,
    },
    leadIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Lead",
        required: true,
      },
    ],
    fromNumber: { type: String, required: true },
    scriptKey: { type: String, required: true },
    voiceKey: { type: String, required: true },
    total: { type: Number, required: true, default: 0 },
    lastIndex: { type: Number, required: true, default: -1 },

    status: {
      type: String,
      enum: ["queued", "running", "paused", "completed", "stopped", "failed", "error"],
      required: true,
      default: "queued",
      index: true,
    },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },

    // ✅ prevents duplicate chaining from Twilio callback retries
    chainKickedAt: { type: Date, default: null },
    chainKickCallSid: { type: String, default: null },

    // AI dialer stats (per session)
    stats: {
      completed: { type: Number, default: 0 },
      booked: { type: Number, default: 0 },
      not_interested: { type: Number, default: 0 },
      no_answer: { type: Number, default: 0 },
      callback: { type: Number, default: 0 },
      do_not_call: { type: Number, default: 0 },
      disconnected: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

let AICallSessionModel: Model<IAICallSession>;

try {
  AICallSessionModel = mongoose.model<IAICallSession>("AICallSession");
} catch {
  AICallSessionModel = mongoose.model<IAICallSession>(
    "AICallSession",
    AICallSessionSchema
  );
}

export default AICallSessionModel;
