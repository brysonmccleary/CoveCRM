import mongoose, { Document, Schema, models } from "mongoose";

export interface ITwilioVoiceUsageCandidate extends Document {
  accountSid: string;
  userEmail: string;
  callSid: string;
  parentCallSid: string;
  status: string;
  direction: string;
  durationSec?: number;
  startedAt?: Date | null;
  endedAt?: Date | null;
  discoveredAt: Date;
  lastCheckedAt: Date;
  meteredAt?: Date | null;
  skippedAt?: Date | null;
  skipReason?: string | null;
  amountCents?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const TwilioVoiceUsageCandidateSchema = new Schema<ITwilioVoiceUsageCandidate>(
  {
    accountSid: { type: String, required: true, index: true },
    userEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    callSid: { type: String, required: true, unique: true, index: true },
    parentCallSid: { type: String, required: true },
    status: { type: String, required: true, index: true },
    direction: { type: String, required: true },
    durationSec: { type: Number },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    discoveredAt: { type: Date, required: true, default: Date.now },
    lastCheckedAt: { type: Date, required: true, default: Date.now },
    meteredAt: { type: Date, default: null, index: true },
    skippedAt: { type: Date, default: null, index: true },
    skipReason: { type: String, default: null },
    amountCents: { type: Number, default: null },
  },
  { timestamps: true },
);

TwilioVoiceUsageCandidateSchema.index(
  { accountSid: 1, meteredAt: 1, skippedAt: 1, startedAt: 1 },
  { name: "twilio_voice_pending_by_account" },
);

export default models.TwilioVoiceUsageCandidate ||
  mongoose.model<ITwilioVoiceUsageCandidate>(
    "TwilioVoiceUsageCandidate",
    TwilioVoiceUsageCandidateSchema,
  );
