import mongoose, { Schema, Document, Model } from "mongoose";

export type AICallTranscriptSource = "voice_turns" | "openai_transcribe" | "none";

export interface IAICallTranscriptTurn {
  role: "ai" | "lead";
  text: string;
  timestamp: Date;
}

export interface IAICallTranscript extends Document {
  callSid: string;
  leadId: mongoose.Types.ObjectId;
  sessionId: mongoose.Types.ObjectId;
  userEmail: string;
  agentName: string;
  leadName: string;
  scriptKey: string;
  outcome: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  turns: IAICallTranscriptTurn[];
  fullText: string;
  transcriptSource: AICallTranscriptSource;
  transcriptBillable: boolean;
  transcriptCostCents: number;
  transcriptChargeCents: number;
  transcriptChargeAccruedCents?: number;
  transcriptChargedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AICallTranscriptTurnSchema = new Schema<IAICallTranscriptTurn>(
  {
    role: {
      type: String,
      enum: ["ai", "lead"],
      required: true,
    },
    text: { type: String, required: true },
    timestamp: { type: Date, required: true },
  },
  { _id: false }
);

const AICallTranscriptSchema = new Schema<IAICallTranscript>(
  {
    callSid: { type: String, required: true, index: true },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
      index: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "AICallSession",
      required: true,
      index: true,
    },
    userEmail: { type: String, required: true, lowercase: true, index: true },
    agentName: { type: String, default: "" },
    leadName: { type: String, default: "" },
    scriptKey: { type: String, default: "" },
    outcome: { type: String, default: "unknown" },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    durationSeconds: { type: Number, required: true, default: 0 },
    turns: { type: [AICallTranscriptTurnSchema], default: [] },
    fullText: { type: String, default: "" },
    transcriptSource: {
      type: String,
      enum: ["voice_turns", "openai_transcribe", "none"],
      default: "voice_turns",
    },
    transcriptBillable: { type: Boolean, default: true },
    transcriptCostCents: { type: Number, default: 0 },
    transcriptChargeCents: { type: Number, default: 0 },
    transcriptChargeAccruedCents: { type: Number, default: 0 },
    transcriptChargedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

AICallTranscriptSchema.index({ userEmail: 1, sessionId: 1, createdAt: -1 });
AICallTranscriptSchema.index({ userEmail: 1, leadId: 1, createdAt: -1 });
AICallTranscriptSchema.index({ callSid: 1, userEmail: 1 }, { unique: true });

let AICallTranscriptModel: Model<IAICallTranscript>;

try {
  AICallTranscriptModel =
    (mongoose.models.AICallTranscript as Model<IAICallTranscript>) ||
    mongoose.model<IAICallTranscript>("AICallTranscript", AICallTranscriptSchema);
} catch {
  AICallTranscriptModel = mongoose.model<IAICallTranscript>(
    "AICallTranscript",
    AICallTranscriptSchema
  );
}

export default AICallTranscriptModel;
