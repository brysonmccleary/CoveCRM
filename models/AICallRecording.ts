// models/AICallRecording.ts
import mongoose, { Schema, Document, Model } from "mongoose";

export type AICallOutcome =
  | "unknown"
  | "booked"
  | "not_interested"
  | "no_answer"
  | "callback"
  | "do_not_call"
  | "disconnected";

export interface IAICallRecording extends Document {
  userEmail: string;
  leadId: mongoose.Types.ObjectId;
  aiCallSessionId?: mongoose.Types.ObjectId | null;
  callSid: string;
  recordingSid?: string | null;
  recordingUrl?: string | null;
  durationSec?: number | null;
  outcome: AICallOutcome;
  notes?: string | null;

  // ✅ Post-call AI Call Overview (optional only)
  transcriptText?: string | null;
  summary?: string | null;
  transcribedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const AICallRecordingSchema = new Schema<IAICallRecording>(
  {
    userEmail: { type: String, required: true, lowercase: true, index: true },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
      index: true,
    },
    aiCallSessionId: {
      type: Schema.Types.ObjectId,
      ref: "AICallSession",
      default: null,
      index: true,
    },
    callSid: { type: String, required: true, index: true },
    recordingSid: { type: String, default: null },
    recordingUrl: { type: String, default: null },
    durationSec: { type: Number, default: null },
    outcome: {
      type: String,
      enum: [
        "unknown",
        "booked",
        "not_interested",
        "no_answer",
        "callback",
        "do_not_call",
        "disconnected",
      ],
      default: "unknown",
      index: true,
    },
    notes: { type: String, default: null },

    // ✅ Post-call transcription fields (optional only)
    transcriptText: { type: String, default: null },
    summary: { type: String, default: null },
    transcribedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

let AICallRecordingModel: Model<IAICallRecording>;

try {
  AICallRecordingModel =
    (mongoose.models.AICallRecording as Model<IAICallRecording>) ||
    mongoose.model<IAICallRecording>("AICallRecording", AICallRecordingSchema);
} catch {
  AICallRecordingModel = mongoose.model<IAICallRecording>(
    "AICallRecording",
    AICallRecordingSchema
  );
}

export default AICallRecordingModel;
