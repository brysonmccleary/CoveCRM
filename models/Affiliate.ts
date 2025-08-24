import mongoose, { Schema, Document, models } from "mongoose";

export interface IReferral {
  name?: string;
  email: string;
  joinedAt: Date;
}

export interface IPayoutEntry {
  amount: number;           // USD
  userEmail: string;        // referred user's email
  date: Date;               // when credited
  invoiceId?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
  note?: string;
}

export interface IAffiliate extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  email: string;
  promoCode: string;

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
  totalReferrals: number;
  totalRevenueGenerated: number;
  totalPayoutsSent: number;
  payoutDue: number;
  lastPayoutDate?: Date;

  // Relations
  referrals: IReferral[];
  payoutHistory: IPayoutEntry[];

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

const AffiliateSchema = new Schema<IAffiliate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    promoCode: { type: String, required: true, unique: true, uppercase: true },

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
    flatPayoutAmount: { type: Number, default: 25.0 },
    totalReferrals: { type: Number, default: 0 },
    totalRevenueGenerated: { type: Number, default: 0 },
    totalPayoutsSent: { type: Number, default: 0 },
    payoutDue: { type: Number, default: 0 },
    lastPayoutDate: { type: Date },

    // Relations
    referrals: { type: [ReferralSchema], default: [] },
    payoutHistory: { type: [PayoutEntrySchema], default: [] },

    // Promo linkage
    promotionCodeId: { type: String },
    couponId: { type: String },
  },
  { timestamps: true },
);

export default models.Affiliate ||
  mongoose.model<IAffiliate>("Affiliate", AffiliateSchema);
