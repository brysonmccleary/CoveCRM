// models/Affiliate.ts
import mongoose, { Schema, Document, models } from "mongoose";
import { AFFILIATE_MONTHLY_CREDIT_USD } from "@/lib/affiliate/payoutPolicy";

export interface IReferral {
  name?: string;
  email: string;
  joinedAt: Date;
}

export interface IPayoutEntry {
  amount: number;           // USD
  userEmail: string;        // referred user's email (can be "" for bulk payouts)
  date: Date;               // when credited
  invoiceId?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
  note?: string;
}

export interface IReferredUser {
  userId?: mongoose.Types.ObjectId;
  joinedAt?: Date;
  planCode?: string;
  billingInterval?: string;
  isActive?: boolean;
  lastPayoutAt?: Date | null;
  totalPayoutsSentToAffiliate?: number;
}

export interface IAffiliate extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  email: string;
  promoCode: string;
  referralCode?: string | null;

  // Stripe / onboarding
  stripeConnectId?: string;
  onboardingCompleted: boolean;
  connectedAccountStatus: "pending" | "verified" | "incomplete" | "restricted";

  // Program/admin state
  approved: boolean;
  approvedAt?: Date;

  // Optional metadata captured at apply time
  teamSize?: string;

  // Payouts/metrics (USD)
  flatPayoutAmount: number;
  totalReferrals: number;          // count of unique referred users (first invoice)
  totalRedemptions: number;        // count of promo code redemptions (can exceed totalReferrals)
  totalRevenueGenerated: number;   // dollars
  totalPayoutsSent: number;        // dollars
  payoutDue: number;               // dollars
  lastPayoutDate?: Date;
  monthlyPayoutRate: number;

  // Relations
  referrals: IReferral[];
  payoutHistory: IPayoutEntry[];
  referredUsers: IReferredUser[];

  // Promo linkage
  promotionCodeId?: string;
  couponId?: string;

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
    userEmail: { type: String, required: true },
    date: { type: Date, required: true },
    invoiceId: { type: String, default: null },
    subscriptionId: { type: String, default: null },
    customerId: { type: String, default: null },
    note: { type: String },
  },
  { _id: false },
);

const ReferredUserSchema = new Schema<IReferredUser>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    joinedAt: { type: Date },
    planCode: { type: String },
    billingInterval: { type: String },
    isActive: { type: Boolean, default: true },
    lastPayoutAt: { type: Date, default: null },
    totalPayoutsSentToAffiliate: { type: Number, default: 0 },
  },
  { _id: false },
);

const AffiliateSchema = new Schema<IAffiliate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    promoCode: { type: String, required: true, unique: true, uppercase: true },
    referralCode: { type: String, unique: true, sparse: true, default: null },

    // Stripe / onboarding
    stripeConnectId: { type: String },
    onboardingCompleted: { type: Boolean, default: false },
    connectedAccountStatus: { type: String, default: "pending" }, // pending|verified|incomplete|restricted

    // Program/admin state
    approved: { type: Boolean, default: false },
    approvedAt: { type: Date },

    // Optional metadata captured at apply time
    teamSize: { type: String },

    // Payouts/metrics (USD)
    flatPayoutAmount: { type: Number, default: AFFILIATE_MONTHLY_CREDIT_USD },
    totalReferrals: { type: Number, default: 0 },
    totalRedemptions: { type: Number, default: 0 },  // <-- added
    totalRevenueGenerated: { type: Number, default: 0 },
    totalPayoutsSent: { type: Number, default: 0 },
    payoutDue: { type: Number, default: 0 },
    lastPayoutDate: { type: Date },
    monthlyPayoutRate: { type: Number, default: AFFILIATE_MONTHLY_CREDIT_USD },

    // Relations
    referrals: { type: [ReferralSchema], default: [] },
    payoutHistory: { type: [PayoutEntrySchema], default: [] },
    referredUsers: { type: [ReferredUserSchema], default: [] },

    // Promo linkage
    promotionCodeId: { type: String },
    couponId: { type: String },
  },
  { timestamps: true },
);

export default models.Affiliate ||
  mongoose.model<IAffiliate>("Affiliate", AffiliateSchema);
