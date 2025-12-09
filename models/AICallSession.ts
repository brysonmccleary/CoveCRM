// models/AICallSession.ts
import mongoose, { Schema, Document, Model } from "mongoose";

export type AICallSessionStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "error";

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
      enum: ["queued", "running", "paused", "completed", "error"],
      required: true,
      default: "queued",
      index: true,
    },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
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
