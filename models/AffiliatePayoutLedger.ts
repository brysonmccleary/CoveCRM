// models/AffiliatePayoutLedger.ts
import mongoose, { Schema, Document, models } from "mongoose";
import {
  AFFILIATE_MONTHLY_CREDIT_CENTS,
  AFFILIATE_MONTHLY_CREDIT_USD,
} from "@/lib/affiliate/payoutPolicy";

export interface IAffiliatePayoutLedger extends Document {
  affiliateId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  month?: string;
  amount: number;
  amountCents?: number;
  stripeInvoiceId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  referredUserEmail?: string | null;
  earnedAt?: Date | null;
  payableAt?: Date | null;
  status:
    | "held"
    | "processing"
    | "paid"
    | "failed"
    | "reversed"
    | "clawback_owed"
    | "pending";
  stripeTransferId?: string | null;
  idempotencyKey: string;
  createdAt: Date;
  paidAt?: Date | null;
  reversedAt?: Date | null;
  reversalReason?: string | null;
  processingStartedAt?: Date | null;
  claimOwner?: string | null;
}

const AffiliatePayoutLedgerSchema = new Schema<IAffiliatePayoutLedger>(
  {
    affiliateId: {
      type: Schema.Types.ObjectId,
      ref: "Affiliate",
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    month: { type: String },
    amount: { type: Number, default: AFFILIATE_MONTHLY_CREDIT_USD },
    amountCents: { type: Number, default: AFFILIATE_MONTHLY_CREDIT_CENTS },
    stripeInvoiceId: { type: String, default: null, index: true },
    stripeSubscriptionId: { type: String, default: null },
    stripeCustomerId: { type: String, default: null },
    referredUserEmail: { type: String, lowercase: true, trim: true, default: null },
    earnedAt: { type: Date, default: null },
    payableAt: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: [
        "held",
        "processing",
        "paid",
        "failed",
        "reversed",
        "clawback_owed",
        "pending",
      ],
      default: "held",
    },
    stripeTransferId: { type: String, default: null },
    idempotencyKey: { type: String, unique: true },
    createdAt: { type: Date, default: Date.now },
    paidAt: { type: Date, default: null },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, default: null },
    processingStartedAt: { type: Date, default: null },
    claimOwner: { type: String, default: null },
  },
  { collection: "affiliatepayoutledger" },
);

AffiliatePayoutLedgerSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: "uniq_affiliate_payout_ledger_idempotency_key" },
);

AffiliatePayoutLedgerSchema.index(
  { affiliateId: 1, userId: 1, month: 1 },
  { name: "affiliate_payout_ledger_lookup" },
);

AffiliatePayoutLedgerSchema.index(
  { affiliateId: 1, stripeInvoiceId: 1 },
  { name: "affiliate_payout_ledger_invoice_lookup" },
);

export default models.AffiliatePayoutLedger ||
  mongoose.model<IAffiliatePayoutLedger>(
    "AffiliatePayoutLedger",
    AffiliatePayoutLedgerSchema,
  );
