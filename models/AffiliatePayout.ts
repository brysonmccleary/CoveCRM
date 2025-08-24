import mongoose, { Schema, Document, models } from "mongoose";

export interface IAffiliatePayout extends Document {
  affiliateId: string; // Affiliate._id
  affiliateEmail?: string; // convenience for filtering
  amount: number; // USD
  currency: string; // "usd"
  periodStart?: Date; // reporting window start
  periodEnd?: Date; // reporting window end
  stripeTransferId?: string; // Stripe transfer id
  status: "queued" | "sent" | "failed"; // lifecycle tracking
  idempotencyKey: string; // unique (e.g., affiliate + triggering invoice)
  createdAt: Date;
  updatedAt: Date;
}

const AffiliatePayoutSchema = new Schema<IAffiliatePayout>(
  {
    affiliateId: { type: String, required: true },
    affiliateEmail: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: "usd" },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    stripeTransferId: { type: String },
    status: {
      type: String,
      enum: ["queued", "sent", "failed"],
      default: "queued",
    },
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

AffiliatePayoutSchema.index(
  { affiliateId: 1, createdAt: -1 },
  { name: "affiliate_payout_by_affiliate" },
);
AffiliatePayoutSchema.index(
  { stripeTransferId: 1 },
  { name: "affiliate_payout_by_transfer" },
);

export default models.AffiliatePayout ||
  mongoose.model<IAffiliatePayout>("AffiliatePayout", AffiliatePayoutSchema);
