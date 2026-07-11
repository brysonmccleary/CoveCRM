// models/BillingEvent.ts
import mongoose, { Schema, Document } from "mongoose";

export type BillingEventSource =
  | "ai_voice_session"
  | "ai_voice_call"
  | "ai_transcript"
  | "regular_usage"
  | "a2p_fee"
  | "subscription"
  | "number_subscription"
  | "other";

export type BillingEventStatus =
  | "pending"
  | "charging"
  | "paid"
  | "applied"
  | "blocked";

export interface IBillingEvent extends Document {
  userId?: string;
  userEmail: string;
  stripeCustomerId?: string;
  source: BillingEventSource;
  sourceId: string;
  amountCents: number;
  description: string;
  status: BillingEventStatus;
  stripeInvoiceItemId?: string;
  stripeInvoiceId?: string;
  paidAt?: Date;
  appliedAt?: Date;
  appliedBucket?: "regular" | "ai_voice" | "a2p";
  appliedAmountCents?: number;
  applicationError?: string;
  applicationFailedAt?: Date;
  applicationAttempts?: number;
  needsApplicationReview?: boolean;
  needsManualReview?: boolean;
  manualReviewReason?: string;
  manualReviewAt?: Date;
  recoveryAttempts?: number;
  idempotencyKey: string;
  blockedReason?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const BillingEventSchema = new Schema<IBillingEvent>(
  {
    userId: { type: String },
    userEmail: { type: String, required: true, index: true },
    stripeCustomerId: { type: String },
    source: {
      type: String,
      required: true,
      enum: [
        "ai_voice_session",
        "ai_voice_call",
        "ai_transcript",
        "regular_usage",
        "a2p_fee",
        "subscription",
        "number_subscription",
        "other",
      ],
    },
    sourceId: { type: String, required: true },
    amountCents: { type: Number, required: true },
    description: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ["pending", "charging", "paid", "applied", "blocked"],
      default: "pending",
    },
    stripeInvoiceItemId: { type: String },
    stripeInvoiceId: { type: String },
    paidAt: { type: Date },
    appliedAt: { type: Date },
    appliedBucket: { type: String, enum: ["regular", "ai_voice", "a2p"] },
    appliedAmountCents: { type: Number },
    applicationError: { type: String },
    applicationFailedAt: { type: Date },
    applicationAttempts: { type: Number, default: 0 },
    needsApplicationReview: { type: Boolean, default: false },
    needsManualReview: { type: Boolean, default: false },
    manualReviewReason: { type: String },
    manualReviewAt: { type: Date },
    recoveryAttempts: { type: Number, default: 0 },
    idempotencyKey: { type: String, required: true },
    blockedReason: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

// Primary idempotency guard: (source, sourceId, amountCents) must be unique.
// A duplicate upsert on this index signals "already processed" → skip Stripe.
BillingEventSchema.index(
  { source: 1, sourceId: 1, amountCents: 1 },
  { unique: true },
);

export default (mongoose.models.BillingEvent as mongoose.Model<IBillingEvent>) ||
  mongoose.model<IBillingEvent>("BillingEvent", BillingEventSchema);
