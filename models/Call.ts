import mongoose, { Schema, Document, models } from "mongoose";
import { Types } from "mongoose";

export interface ICall extends Document {
  userEmail: string;
  leadId?: Types.ObjectId | string;
  direction: "outbound" | "inbound";
  callSid: string;

  // numbers + routing
  ownerNumber?: string;    // our Twilio DID that owns the call
  otherNumber?: string;    // the external/lead number
  conferenceName?: string; // name we dialed into

  startedAt?: Date;
  completedAt?: Date;
  duration?: number;       // total seconds
  talkTime?: number;       // seconds with speech (optional)

  recordingSid?: string;
  recordingUrl?: string;   // final mp3 URL
  recordingDuration?: number; // seconds
  recordingStatus?: string;   // completed | in-progress | failed | ...

  aiEnabledAtCallTime?: boolean;
  transcript?: string;
  aiSummary?: string;
  aiActionItems?: string[];
  aiBullets?: string[];    // key points list
  aiScore?: number;        // 0..100
  aiSentiment?: "positive" | "neutral" | "negative";
  aiProcessing?: "pending" | "done" | "error";
}

const CallSchema = new Schema<ICall>(
  {
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.Mixed },
    direction: { type: String, enum: ["outbound", "inbound"], default: "outbound" },
    callSid: { type: String, required: true, unique: true },

    ownerNumber: String,
    otherNumber: String,
    conferenceName: String,

    startedAt: Date,
    completedAt: Date,
    duration: Number,
    talkTime: Number,

    recordingSid: String,
    recordingUrl: String,
    recordingDuration: Number,
    recordingStatus: String,

    aiEnabledAtCallTime: Boolean,
    transcript: String,
    aiSummary: String,
    aiActionItems: { type: [String], default: [] },
    aiBullets: { type: [String], default: [] },
    aiScore: Number,
    aiSentiment: { type: String, enum: ["positive", "neutral", "negative"] },
    aiProcessing: { type: String, enum: ["pending", "done", "error"], default: undefined },
  },
  { timestamps: true }
);

// Helpful indexes
CallSchema.index({ userEmail: 1, startedAt: -1 }, { name: "call_user_started_desc" });
CallSchema.index({ userEmail: 1, completedAt: -1 }, { name: "call_user_completed_desc" });
CallSchema.index({ leadId: 1, completedAt: -1 }, { name: "call_by_lead_completed_desc" });
CallSchema.index({ userEmail: 1, direction: 1, startedAt: -1 }, { name: "call_user_dir_started_desc" });
CallSchema.index({ userEmail: 1, recordingUrl: 1 }, { name: "call_user_has_recording" });

export default models.Call || mongoose.model<ICall>("Call", CallSchema);
