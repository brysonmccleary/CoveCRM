// models/Call.ts
import mongoose, { Schema, Document, models } from "mongoose";
import { Types } from "mongoose";

export interface ICall extends Document {
  userEmail: string;
  leadId?: Types.ObjectId | string;
  direction: "outbound" | "inbound";
  callSid: string;
  billedAt?: Date;

  // numbers + routing
  ownerNumber?: string;    // our Twilio DID that owns the call
  otherNumber?: string;    // the external/lead number
  from?: string;           // alias for ownerNumber (some code sets from/to)
  to?: string;             // alias for otherNumber
  conferenceName?: string; // name we dialed into

  startedAt?: Date;
  completedAt?: Date;
  endedAt?: Date;          // lifecycle alias
  duration?: number;       // total seconds
  durationSec?: number;    // alias
  talkTime?: number;       // seconds with speech (optional)

  // ✅ Twilio AMD / AnsweredBy capture
  answeredBy?: string;     // "human" | "machine_*" | "fax" | "unknown" | etc.
  isVoicemail?: boolean;   // AMD or AnsweredBy indicates machine

  recordingSid?: string;
  recordingUrl?: string;         // final https URL (mp3/wav)
  recordingDuration?: number;    // seconds
  recordingStatus?: string;      // completed | in-progress | failed | ...
  recordingFormat?: string;      // mp3 | wav | unknown
  recordingChannels?: string;    // mono | dual | ...
  recordingSource?: string;      // RecordVerb | DialVerb | ...
  recordingType?: string;        // audio | ...
  recordingSizeBytes?: number;   // HEAD content-length when available

  aiEnabledAtCallTime?: boolean;
  transcript?: string;
  aiSummary?: string;
  aiActionItems?: string[];
  aiBullets?: string[];    // key points list
  aiScore?: number;        // 0..100
  aiSentiment?: "positive" | "neutral" | "negative";
  aiProcessing?: "pending" | "done" | "error";

  // ✅ Structured AI Call Overview (used by lead middle panel)
  aiOverviewReady?: boolean;
  aiOverview?: {
    overviewBullets: string[];
    keyDetails: string[];
    objections: string[];
    questions: string[];
    nextSteps: string[];
    outcome:
      | "Booked"
      | "Callback"
      | "Not Interested"
      | "No Answer"
      | "Voicemail"
      | "Other";
    appointmentTime?: string;
    sentiment?: "Positive" | "Neutral" | "Negative";
    generatedAt: Date;
    version: 1;
  };
}

const CallSchema = new Schema<ICall>(
  {
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.Mixed },
    direction: { type: String, enum: ["outbound", "inbound"], default: "outbound" },
    callSid: { type: String, required: true, unique: true },

    billedAt: Date,

    ownerNumber: String,
    otherNumber: String,
    from: String,
    to: String,
    conferenceName: String,

    startedAt: Date,
    completedAt: Date,
    endedAt: Date,
    duration: Number,
    durationSec: Number,
    talkTime: Number,

    // ✅ store AnsweredBy so dashboard can exclude machines/voicemail
    answeredBy: String,
    isVoicemail: { type: Boolean, default: false },

    recordingSid: String,
    recordingUrl: String,
    recordingDuration: Number,
    recordingStatus: String,
    recordingFormat: String,
    recordingChannels: String,
    recordingSource: String,
    recordingType: String,
    recordingSizeBytes: Number,

    aiEnabledAtCallTime: Boolean,
    transcript: String,
    aiSummary: String,
    aiActionItems: { type: [String], default: [] },
    aiBullets: { type: [String], default: [] },
    aiScore: Number,
    aiSentiment: { type: String, enum: ["positive", "neutral", "negative"] },
    aiProcessing: { type: String, enum: ["pending", "done", "error"], default: undefined },

    // ✅ AI Call Overview fields (must be in schema or Mongoose will drop them)
    aiOverviewReady: { type: Boolean, default: false },
    aiOverview: {
      type: new Schema(
        {
          overviewBullets: { type: [String], default: [] },
          keyDetails: { type: [String], default: [] },
          objections: { type: [String], default: [] },
          questions: { type: [String], default: [] },
          nextSteps: { type: [String], default: [] },
          outcome: {
            type: String,
            enum: ["Booked", "Callback", "Not Interested", "No Answer", "Voicemail", "Other"],
            default: "Other",
          },
          appointmentTime: { type: String, default: "" },
          sentiment: { type: String, enum: ["Positive", "Neutral", "Negative"], default: "Neutral" },
          generatedAt: { type: Date, default: undefined },
          version: { type: Number, default: 1 },
        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { timestamps: true }
);

// Helpful indexes
CallSchema.index({ userEmail: 1, startedAt: -1 }, { name: "call_user_started_desc" });
CallSchema.index({ userEmail: 1, completedAt: -1 }, { name: "call_user_completed_desc" });
CallSchema.index({ leadId: 1, completedAt: -1 }, { name: "call_by_lead_completed_desc" });
CallSchema.index({ userEmail: 1, direction: 1, startedAt: -1 }, { name: "call_user_dir_started_desc" });
CallSchema.index({ userEmail: 1, recordingUrl: 1 }, { name: "call_user_has_recording" });
CallSchema.index({ userEmail: 1, isVoicemail: 1, completedAt: -1 }, { name: "call_user_voicemail" });

// ✅ optional index for analysis/debugging (does not change behavior)
CallSchema.index({ userEmail: 1, answeredBy: 1, completedAt: -1 }, { name: "call_user_answeredBy" });

export default models.Call || mongoose.model<ICall>("Call", CallSchema);
