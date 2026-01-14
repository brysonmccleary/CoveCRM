// models/Call.ts
import mongoose, { Schema, Document, models } from "mongoose";
import { Types } from "mongoose";

export interface ICall extends Document {
  userEmail: string;
  leadId?: Types.ObjectId | string;
  direction: "outbound" | "inbound";
  callSid: string;

  // numbers + routing
  ownerNumber?: string;
  otherNumber?: string;
  from?: string;
  to?: string;
  conferenceName?: string;

  startedAt?: Date;
  completedAt?: Date;
  endedAt?: Date;
  duration?: number;
  durationSec?: number;
  talkTime?: number;
  isVoicemail?: boolean;

  // ✅ AMD persistence (AnsweredBy)
  amd?: {
    answeredBy?: string;
  };

  recordingSid?: string;
  recordingUrl?: string;
  recordingDuration?: number;
  recordingStatus?: string;
  recordingFormat?: string;
  recordingChannels?: string;
  recordingSource?: string;
  recordingType?: string;
  recordingSizeBytes?: number;

  aiEnabledAtCallTime?: boolean;
  transcript?: string;
  aiSummary?: string;
  aiActionItems?: string[];
  aiBullets?: string[];
  aiScore?: number;
  aiSentiment?: "positive" | "neutral" | "negative";
  aiProcessing?: "pending" | "done" | "error";

  aiOverviewReady?: boolean;
  aiOverview?: {
    overviewBullets: string[];
    keyDetails: string[];
    objections: string[];
    questions: string[];
    nextSteps: string[];
    outcome: "Booked" | "Callback" | "Not Interested" | "No Answer" | "Voicemail" | "Other";
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
    isVoicemail: { type: Boolean, default: false },

    // ✅ Add AMD to schema so Mongoose does not drop it
    amd: {
      type: new Schema(
        {
          answeredBy: { type: String, default: "" }, // "human" | "machine_*"
        },
        { _id: false },
      ),
      default: undefined,
    },

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
        { _id: false },
      ),
      default: undefined,
    },
  },
  { timestamps: true },
);

// Helpful indexes
CallSchema.index({ userEmail: 1, startedAt: -1 }, { name: "call_user_started_desc" });
CallSchema.index({ userEmail: 1, completedAt: -1 }, { name: "call_user_completed_desc" });
CallSchema.index({ leadId: 1, completedAt: -1 }, { name: "call_by_lead_completed_desc" });
CallSchema.index({ userEmail: 1, direction: 1, startedAt: -1 }, { name: "call_user_dir_started_desc" });
CallSchema.index({ userEmail: 1, recordingUrl: 1 }, { name: "call_user_has_recording" });
CallSchema.index({ userEmail: 1, isVoicemail: 1, completedAt: -1 }, { name: "call_user_voicemail" });

export default models.Call || mongoose.model<ICall>("Call", CallSchema);
