// models/AffiliatePayout.ts
import mongoose, { Schema, Document, models } from "mongoose";

export interface IAffiliatePayout extends Document {
  affiliateId: string;              // Affiliate._id
  affiliateEmail?: string;          // convenience for filtering
  amount: number;                   // USD (normalized to 2 decimals)
  currency: string;                 // "usd"
  periodStart?: Date;               // reporting window start
  periodEnd?: Date;                 // reporting window end
  stripeTransferId?: string;        // Stripe transfer id
  status: "queued" | "sent" | "failed"; // lifecycle tracking
  idempotencyKey: string;           // unique (e.g., affiliate+period+amount OR affiliate+invoice)
  createdAt: Date;
  updatedAt: Date;
}

const AffiliatePayoutSchema = new Schema<IAffiliatePayout>(
  {
    affiliateId: { type: String, required: true },
    affiliateEmail: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: "usd", lowercase: true, trim: true },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    stripeTransferId: { type: String },
    status: {
      type: String,
      enum: ["queued", "sent", "failed"],
      default: "queued",
      index: true,
    },
    idempotencyKey: { type: String, required: true, unique: true, trim: true },
  },
  { timestamps: true },
);

// ---------- Normalizers ----------
AffiliatePayoutSchema.pre("save", function (next) {
  // normalize email/currency
  if (this.affiliateEmail) this.affiliateEmail = this.affiliateEmail.trim().toLowerCase();
  if (this.currency) this.currency = this.currency.trim().toLowerCase();

  // round to 2 decimals defensively (avoid float drift)
  if (typeof this.amount === "number") {
    this.amount = Math.round(this.amount * 100) / 100;
  }
  next();
});

// ---------- Indexes ----------
AffiliatePayoutSchema.index(
  { idempotencyKey: 1 },
  { unique: true, name: "uniq_idempotency_key" },
);

AffiliatePayoutSchema.index(
  { affiliateId: 1, createdAt: -1 },
  { name: "affiliate_payout_by_affiliate" },
);

AffiliatePayoutSchema.index(
  { stripeTransferId: 1 },
  { name: "affiliate_payout_by_transfer" },
);

AffiliatePayoutSchema.index(
  { affiliateEmail: 1, createdAt: -1 },
  { name: "affiliate_payout_by_email" },
);

export default models.AffiliatePayout ||
  mongoose.model<IAffiliatePayout>("AffiliatePayout", AffiliatePayoutSchema);
