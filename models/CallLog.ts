// /models/CallLog.ts
import mongoose, { Schema, Document, models } from "mongoose";

export interface ICallLog extends Document {
  userEmail: string; // <-- updated
  leadId?: string;
  phoneNumber: string;
  status: "connected" | "no_answer" | "busy" | "failed";
  durationSeconds?: number;
  timestamp: Date;
}

const CallLogSchema = new Schema<ICallLog>({
  userEmail: { type: String, required: true }, // <-- updated
  leadId: { type: String },
  phoneNumber: { type: String, required: true },
  status: {
    type: String,
    enum: ["connected", "no_answer", "busy", "failed"],
    required: true,
  },
  durationSeconds: { type: Number },
  timestamp: { type: Date, default: Date.now },
});

export default models.CallLog ||
  mongoose.model<ICallLog>("CallLog", CallLogSchema);
