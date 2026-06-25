// models/AffiliatePayoutLedger.ts
import mongoose, { Schema, Document, models } from "mongoose";

export interface IAffiliatePayoutLedger extends Document {
  affiliateId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  month: string;
  amount: number;
  status: "pending" | "paid" | "failed";
  stripeTransferId?: string | null;
  idempotencyKey: string;
  createdAt: Date;
  paidAt?: Date | null;
}

const AffiliatePayoutLedgerSchema = new Schema<IAffiliatePayoutLedger>(
  {
    affiliateId: {
      type: Schema.Types.ObjectId,
      ref: "Affiliate",
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    month: { type: String, required: true },
    amount: { type: Number, default: 12.50 },
    status: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    stripeTransferId: { type: String, default: null },
    idempotencyKey: { type: String, unique: true },
    createdAt: { type: Date, default: Date.now },
    paidAt: { type: Date, default: null },
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

export default models.AffiliatePayoutLedger ||
  mongoose.model<IAffiliatePayoutLedger>(
    "AffiliatePayoutLedger",
    AffiliatePayoutLedgerSchema,
  );
