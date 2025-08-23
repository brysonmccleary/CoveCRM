// /models/CallLog.ts
import mongoose, { Schema, Document, models } from "mongoose";

export interface ICallLog extends Document {
  userEmail: string;
  leadId?: string;
  phoneNumber: string;

  // Optional fields (present in some logs / future-proofing)
  direction?: string; // e.g., "outbound" | "inbound"
  kind?: string;      // e.g., "call"

  status: "connected" | "no_answer" | "busy" | "failed" | string;
  durationSeconds?: number;
  timestamp: Date;
}

const CallLogSchema = new Schema<ICallLog>({
  userEmail: { type: String, required: true },
  leadId: { type: String },
  phoneNumber: { type: String, required: true },

  direction: { type: String },
  kind: { type: String },

  status: {
    type: String,
    enum: ["connected", "no_answer", "busy", "failed"],
    required: true,
  },
  durationSeconds: { type: Number },
  timestamp: { type: Date, default: Date.now },
});

/** 🔎 Indexes
 * - by_user_timestamp: core listing / 10-day windows
 * - status_by_user_date: fast "talks" (connected/answered/completed)
 * - dir_kind_by_user_date: fast "dials" when direction/kind present
 * - by_phone_date: quick per-number history drill-downs
 */
CallLogSchema.index(
  { userEmail: 1, timestamp: -1 },
  { name: "by_user_timestamp" },
);

CallLogSchema.index(
  { userEmail: 1, status: 1, timestamp: -1 },
  { name: "status_by_user_date" },
);

// Only helpful if you set direction/kind on logs; safe partial index
CallLogSchema.index(
  { userEmail: 1, direction: 1, kind: 1, timestamp: -1 },
  {
    name: "dir_kind_by_user_date",
    partialFilterExpression: {
      direction: { $exists: true, $type: "string" },
      kind: { $exists: true, $type: "string" },
    },
  },
);

CallLogSchema.index(
  { phoneNumber: 1, timestamp: -1 },
  { name: "by_phone_date" },
);

export default models.CallLog ||
  mongoose.model<ICallLog>("CallLog", CallLogSchema);
