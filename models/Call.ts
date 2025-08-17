// /models/Call.ts
import mongoose, { Schema, Document, models } from "mongoose";
import { Types } from "mongoose";

export interface ICall extends Document {
  userEmail: string;
  leadId?: Types.ObjectId | string;
  direction: "outbound" | "inbound";
  callSid: string;

  startedAt?: Date;
  completedAt?: Date;
  duration?: number;  // total sec
  talkTime?: number;  // sec with speech (optional if you compute)

  recordingSid?: string;
  recordingUrl?: string;       // final mp3 streamable URL
  recordingDuration?: number;  // sec
  recordingStatus?: string;    // completed | processing | failed | ...

  aiEnabledAtCallTime?: boolean;
  transcript?: string;
  aiSummary?: string;
  aiActionItems?: string[];
  aiSentiment?: "positive" | "neutral" | "negative";
  aiProcessing?: "pending" | "done" | "error";
}

const CallSchema = new Schema<ICall>(
  {
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.Mixed }, // keep flexible (ObjectId|string), matches your usage
    direction: { type: String, enum: ["outbound", "inbound"], default: "outbound" },
    callSid: { type: String, required: true, unique: true },

    startedAt: { type: Date },
    completedAt: { type: Date },
    duration: { type: Number },
    talkTime: { type: Number },

    recordingSid: { type: String },
    recordingUrl: { type: String },
    recordingDuration: { type: Number },
    recordingStatus: { type: String },

    aiEnabledAtCallTime: { type: Boolean },
    transcript: { type: String },
    aiSummary: { type: String },
    aiActionItems: { type: [String], default: [] },
    aiSentiment: { type: String, enum: ["positive", "neutral", "negative"] },
    aiProcessing: { type: String, enum: ["pending", "done", "error"], default: undefined },
  },
  { timestamps: true }
);

// ===== Helpful indexes (added, non-breaking) =====
// Existing:
CallSchema.index({ userEmail: 1, startedAt: -1 });
CallSchema.index({ userEmail: 1, completedAt: -1 });

// New: fast by-lead queries (e.g., /api/calls/by-lead)
CallSchema.index({ leadId: 1, completedAt: -1 }, { name: "call_by_lead_completed_desc" });

// New: direction scans + recents
CallSchema.index({ userEmail: 1, direction: 1, startedAt: -1 }, { name: "call_user_dir_started_desc" });

// New: “has recording” lookups in feeds
CallSchema.index({ userEmail: 1, recordingUrl: 1 }, { name: "call_user_has_recording" });

// Keep model export
export default models.Call || mongoose.model<ICall>("Call", CallSchema);
