// models/AICallUsageLedger.ts
import mongoose, { Schema, Document, models } from "mongoose";

export type AICallUsageLedgerStatus =
  | "pending"
  | "charging"
  | "accrued"
  | "stripe_created"
  | "paid"
  | "failed"
  | "skipped";

export interface IAICallUsageLedger extends Document {
  callSid: string;
  userEmail: string;
  userId?: mongoose.Types.ObjectId | null;
  stripeCustomerId?: string | null;
  aiCallSessionId?: mongoose.Types.ObjectId | null;
  durationSec: number;
  billableSeconds: number;
  billableMinutes: number;
  ratePerMinute: number;
  amountCents: number;
  status: AICallUsageLedgerStatus;
  stripeInvoiceId?: string | null;
  stripeInvoiceItemId?: string | null;
  source?: "twilio_duration" | "usage_post_minutes";
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  paidAt?: Date | null;
  skippedReason?: string | null;
}

const AICallUsageLedgerSchema = new Schema<IAICallUsageLedger>(
  {
    callSid: { type: String, required: true, unique: true, index: true },
    userEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    stripeCustomerId: { type: String, default: null, index: true },
    aiCallSessionId: { type: Schema.Types.ObjectId, ref: "AICallSession", default: null },
    durationSec: { type: Number, required: true, default: 0 },
    billableSeconds: { type: Number, required: true, default: 0 },
    billableMinutes: { type: Number, required: true, default: 0 },
    ratePerMinute: { type: Number, required: true, default: 0 },
    amountCents: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ["pending", "charging", "accrued", "stripe_created", "paid", "failed", "skipped"],
      default: "pending",
      index: true,
    },
    stripeInvoiceId: { type: String, default: null },
    stripeInvoiceItemId: { type: String, default: null },
    source: {
      type: String,
      enum: ["twilio_duration", "usage_post_minutes"],
      default: "twilio_duration",
    },
    idempotencyKey: { type: String, required: true, unique: true },
    metadata: { type: Schema.Types.Mixed },
    paidAt: { type: Date, default: null },
    skippedReason: { type: String, default: null },
  },
  { timestamps: true },
);

AICallUsageLedgerSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: "uniq_ai_call_usage_ledger_idempotency_key" },
);
AICallUsageLedgerSchema.index(
  { userEmail: 1, createdAt: -1 },
  { name: "ai_call_usage_ledger_user_created_desc" },
);

export default models.AICallUsageLedger ||
  mongoose.model<IAICallUsageLedger>("AICallUsageLedger", AICallUsageLedgerSchema);
