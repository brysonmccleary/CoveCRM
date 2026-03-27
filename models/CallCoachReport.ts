// models/CallCoachReport.ts
import mongoose, { Schema, Document, models } from "mongoose";
import { Types } from "mongoose";

export interface IObjectionEncountered {
  objection: string;
  howHandled: string;
  betterResponse: string;
  wasOvercome: boolean;
  conceptConfusion?: string | null;
}

export interface ISandwichFeedback {
  topBread: string[];
  filling: string[];
  bottomBread: string[];
}

export interface IScoreBreakdown {
  opening: number;
  rapport: number;
  discovery: number;
  presentation: number;
  objectionHandling: number;
  closing: number;
}

export interface ICallCoachReport extends Document {
  callId: Types.ObjectId | string;
  callSid?: string;
  userId?: Types.ObjectId | string;
  userEmail: string;
  leadId?: Types.ObjectId | string;
  leadName?: string;
  callScore: number;
  scoreBreakdown: IScoreBreakdown;
  whatWentWell: string[];
  whatToImprove: string[];
  sandwichFeedback?: ISandwichFeedback;
  managerSuggestion?: string | null;
  objectionsEncountered: IObjectionEncountered[];
  nextStepRecommendation: string;
  callSummary: string;
  transcript?: string;
  durationSeconds?: number;
  generatedAt: Date;
}

const CallCoachReportSchema = new Schema<ICallCoachReport>(
  {
    callId: { type: Schema.Types.Mixed, required: true, index: true },
    callSid: { type: String, index: true },
    userId: { type: Schema.Types.Mixed },
    userEmail: { type: String, required: true, index: true },
    leadId: { type: Schema.Types.Mixed },
    leadName: { type: String, default: "" },
    callScore: { type: Number, required: true, min: 1, max: 10 },
    scoreBreakdown: {
      type: new Schema(
        {
          opening: { type: Number, min: 1, max: 10 },
          rapport: { type: Number, min: 1, max: 10 },
          discovery: { type: Number, min: 1, max: 10 },
          presentation: { type: Number, min: 1, max: 10 },
          objectionHandling: { type: Number, min: 1, max: 10 },
          closing: { type: Number, min: 1, max: 10 },
        },
        { _id: false }
      ),
    },
    whatWentWell: { type: [String], default: [] },
    whatToImprove: { type: [String], default: [] },
    sandwichFeedback: {
      type: new Schema(
        {
          topBread: { type: [String], default: [] },
          filling: { type: [String], default: [] },
          bottomBread: { type: [String], default: [] },
        },
        { _id: false }
      ),
      default: undefined,
    },
    managerSuggestion: { type: String, default: null },
    objectionsEncountered: {
      type: [
        new Schema(
          {
            objection: { type: String },
            howHandled: { type: String },
            betterResponse: { type: String },
            wasOvercome: { type: Boolean },
            conceptConfusion: { type: String, default: null },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    nextStepRecommendation: { type: String, default: "" },
    callSummary: { type: String, default: "" },
    transcript: { type: String },
    durationSeconds: { type: Number },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

CallCoachReportSchema.index({ userEmail: 1, generatedAt: -1 });
CallCoachReportSchema.index({ callId: 1, userEmail: 1 }, { unique: true });

export default models.CallCoachReport ||
  mongoose.model<ICallCoachReport>("CallCoachReport", CallCoachReportSchema);
