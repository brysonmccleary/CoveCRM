import mongoose, { Document, Schema, models } from "mongoose";

export type LiveTransferUsageLedgerStatus =
  | "pending"
  | "metering"
  | "finalizing"
  | "recorded_not_billed"
  | "accrued"
  | "failed"
  | "no_human_answer";

export interface ILiveTransferUsageLedger extends Document {
  userEmail: string;
  aiCallSessionId?: mongoose.Types.ObjectId | null;
  leadId?: mongoose.Types.ObjectId | null;
  leadCallSid: string;
  agentCallSid: string;
  conferenceName: string;
  transferInitiatedAt: Date;
  agentAnsweredAt?: Date | null;
  endedAt?: Date | null;
  billableSeconds: number;
  billableMinutes: number;
  ratePerMinute: number;
  amountCents: number;
  status: LiveTransferUsageLedgerStatus;
  stripeInvoiceItemId?: string | null;
  idempotencyKey: string;
  runawayCapped?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LiveTransferUsageLedgerSchema = new Schema<ILiveTransferUsageLedger>(
  {
    userEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    aiCallSessionId: { type: Schema.Types.ObjectId, ref: "AICallSession", default: null, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    leadCallSid: { type: String, required: true, index: true },
    agentCallSid: { type: String, required: true, unique: true, index: true },
    conferenceName: { type: String, required: true, index: true },
    transferInitiatedAt: { type: Date, required: true },
    agentAnsweredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    billableSeconds: { type: Number, required: true, default: 0 },
    billableMinutes: { type: Number, required: true, default: 0 },
    ratePerMinute: { type: Number, required: true },
    amountCents: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ["pending", "metering", "finalizing", "recorded_not_billed", "accrued", "failed", "no_human_answer"],
      required: true,
      default: "pending",
      index: true,
    },
    stripeInvoiceItemId: { type: String, default: null },
    idempotencyKey: { type: String, required: true, unique: true },
    runawayCapped: { type: Boolean, default: false },
  },
  { timestamps: true },
);

LiveTransferUsageLedgerSchema.index(
  { userEmail: 1, createdAt: -1 },
  { name: "live_transfer_usage_ledger_user_created_desc" },
);

export default models.LiveTransferUsageLedger ||
  mongoose.model<ILiveTransferUsageLedger>("LiveTransferUsageLedger", LiveTransferUsageLedgerSchema);
