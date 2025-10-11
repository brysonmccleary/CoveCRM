import mongoose, { Schema, Document, models } from "mongoose";

export interface IReferral {
  name?: string;
  email: string;
  joinedAt: Date;
}

export interface IPayoutEntry {
  amount: number;                 // USD (can be negative for reversals)
  userEmail?: string | null;      // may be null for refund reversals
  date: Date;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
  note?: string;
}

export interface IAffiliate extends Document {
  // Who (all optional so we can auto-create from Stripe promo webhooks)
  userId?: mongoose.Types.ObjectId;
  name?: string;
  email?: string;

  // The public code users type (UPPERCASE)
  promoCode: string;

  // Stripe linking
  promotionCodeId?: string; // promo_xxx
  couponId?: string;        // N4cqydQm

  // Stripe Connect / onboarding
  stripeConnectId?: string; // acct_xxx
  onboardingCompleted?: boolean;
  connectedAccountStatus?: "pending" | "verified" | "incomplete" | "restricted";

  // Program state
  approved?: boolean;
  approvedAt?: Date;

  // Optional metadata
  teamSize?: string;

  // Payouts / metrics (USD)
  flatPayoutAmount?: number;      // default payout per paid invoice
  totalReferrals?: number;
  totalRevenueGenerated?: number; // lifetime gross revenue attributed
  totalPayoutsSent?: number;
  payoutDue?: number;             // running balance owed
  lastPayoutDate?: Date;

  // Lists
  referrals?: IReferral[];
  payoutHistory?: IPayoutEntry[];

  createdAt: Date;
  updatedAt: Date;
}

const ReferralSchema = new Schema<IReferral>(
  {
    name: { type: String },
    email: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const PayoutEntrySchema = new Schema<IPayoutEntry>(
  {
    amount: { type: Number, required: true },
    userEmail: { type: String, default: null },
    date: { type: Date, required: true },
    invoiceId: { type: String, default: null },
    subscriptionId: { type: String, default: null },
    customerId: { type: String, default: null },
    note: { type: String },
  },
  { _id: false },
);

const AffiliateSchema = new Schema<IAffiliate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    name: { type: String },
    email: { type: String, lowercase: true, trim: true },

    promoCode: { type: String, required: true, unique: true, uppercase: true, index: true },

    promotionCodeId: { type: String, index: true },
    couponId: { type: String },

    stripeConnectId: { type: String, index: true },
    onboardingCompleted: { type: Boolean, default: false },
    connectedAccountStatus: {
      type: String,
      enum: ["pending", "verified", "incomplete", "restricted"],
      default: "pending",
    },

    approved: { type: Boolean, default: false },
    approvedAt: { type: Date },

    teamSize: { type: String },

    flatPayoutAmount: { type: Number, default: 25.0 },
    totalReferrals: { type: Number, default: 0 },
    totalRevenueGenerated: { type: Number, default: 0 },
    totalPayoutsSent: { type: Number, default: 0 },
    payoutDue: { type: Number, default: 0 },
    lastPayoutDate: { type: Date },

    referrals: { type: [ReferralSchema], default: [] },
    payoutHistory: { type: [PayoutEntrySchema], default: [] },
  },
  { timestamps: true },
);

// Helpful indexes
AffiliateSchema.index({ promoCode: 1 }, { unique: true });
AffiliateSchema.index({ affiliateEmail: 1 }); // no-op if field absent on some docs

export default (models.Affiliate as mongoose.Model<IAffiliate>) ||
  mongoose.model<IAffiliate>("Affiliate", AffiliateSchema);
