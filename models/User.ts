// /models/User.ts
import mongoose, { Schema } from "mongoose";

export interface IUser {
  email: string;
  password?: string;
  name?: string;
  role?: "user" | "admin";
  createdAt?: Date;
  username?: string;

  // ✅ Agent’s device number to ring first for outbound calls
  agentPhone?: string;

  // ✅ Stripe billing
  stripeCustomerId?: string;

  numbers?: {
    sid: string;
    phoneNumber: string;
    subscriptionId?: string;
    usage?: {
      callsMade: number;
      callsReceived: number;
      textsSent: number;
      textsReceived: number;
      cost: number;
    };
    // 🔹 Optional number metadata (for Twilio sync)
    status?: string; // e.g. "active"
    country?: string; // e.g. "US"
    carrier?: string;
    capabilities?: {
      voice?: boolean;
      sms?: boolean;
      mms?: boolean;
    };
    purchasedAt?: Date;
    messagingServiceSid?: string; // which MS this number is attached to (if any)
    friendlyName?: string;
  }[];

  assignedDrips?: string[];
  leadIds?: string[];

  // ✅ Google Sheets
  googleSheets?: {
    accessToken: string;
    refreshToken: string;
    expiryDate: number;
    googleEmail: string;
    sheets?: {
      sheetId: string;
      folderName: string;
    }[];
  };

  googleTokens?: {
    accessToken: string;
    refreshToken?: string;
    expiryDate?: number;
  };

  // ✅ Calendar settings
  calendarId?: string;
  bookingSettings?: {
    timezone: string; // IANA tz, e.g. "America/Los_Angeles" (AZ → "America/Phoenix")
    slotLength: number;
    bufferTime: number;
    workingHours: {
      [day: string]: { start: string; end: string };
    };
    maxPerDay: number;
    autoConfirm: boolean;
  };

  aiAssistantName?: string;

  // ✅ Affiliate fields
  referralCode?: string;
  referredBy?: string;
  affiliateCode?: string;
  affiliateApproved?: boolean;
  commissionEarned?: number;
  commissionThisMonth?: number;
  lastPayoutDate?: Date;
  stripeConnectId?: string;
  totalReferralEarnings?: number;
  commissionHistory?: { [month: string]: number };

  // ✅ AI access fields
  hasAI?: boolean;
  plan?: "Free" | "Pro";

  // ✅ Subscription
  subscriptionStatus?: "active" | "canceled";

  // ✅ AI usage tracking
  aiUsage?: {
    openAiCost: number;
    twilioCost: number;
    totalCost: number;
  };

  // ✅ New: usage balance for billing
  usageBalance?: number;

  // ✅ Notification Preferences
  notifications?: {
    emailReminders?: boolean;
    dripAlerts?: boolean;
    bookingConfirmations?: boolean;
  };

  // ✅ Country
  country?: string;

  // ✅ NEW: A2P / Twilio Messaging state (populated by sync endpoint)
  a2p?: {
    brandSid?: string;
    brandStatus?: string; // e.g. "APPROVED", "PENDING"
    campaignSid?: string;
    campaignStatus?: string; // e.g. "ACTIVE"
    messagingServiceSid?: string;
    messagingReady?: boolean; // gate for sendSMS()
    lastSyncedAt?: Date;
  };

  // ✅ NEW: last time numbers were refreshed from Twilio
  numbersLastSyncedAt?: Date;
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true },
  password: { type: String },
  name: { type: String },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  createdAt: { type: Date, default: Date.now },
  username: { type: String },

  // ✅ Agent’s device number used for bridging outbound calls
  agentPhone: { type: String },

  // ✅ Stripe billing
  stripeCustomerId: { type: String },

  numbers: [
    {
      sid: String,
      phoneNumber: String,
      subscriptionId: String,
      usage: {
        callsMade: { type: Number, default: 0 },
        callsReceived: { type: Number, default: 0 },
        textsSent: { type: Number, default: 0 },
        textsReceived: { type: Number, default: 0 },
        cost: { type: Number, default: 0 },
      },
      // 🔹 Optional number metadata (safe to add)
      status: String,
      country: String,
      carrier: String,
      capabilities: {
        voice: { type: Boolean, default: undefined },
        sms: { type: Boolean, default: undefined },
        mms: { type: Boolean, default: undefined },
      },
      purchasedAt: Date,
      messagingServiceSid: String,
      friendlyName: String,
    },
  ],

  assignedDrips: [String],
  leadIds: [String],

  googleSheets: {
    accessToken: String,
    refreshToken: String,
    expiryDate: Number,
    googleEmail: String,
    sheets: [
      {
        sheetId: String,
        folderName: String,
      },
    ],
  },

  googleTokens: {
    accessToken: String,
    refreshToken: String,
    expiryDate: Number,
  },

  calendarId: String,

  // ✅ Defaults added here so every user has a usable setup out of the box
  bookingSettings: {
    timezone: { type: String, default: "America/Los_Angeles" },
    slotLength: { type: Number, default: 30 },
    bufferTime: { type: Number, default: 0 },
    workingHours: { type: Schema.Types.Mixed, default: {} },
    maxPerDay: { type: Number, default: 0 },
    autoConfirm: { type: Boolean, default: true },
  },

  aiAssistantName: { type: String, default: "Taylor" },

  // ✅ Affiliate fields
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: String,
  affiliateCode: String,
  affiliateApproved: { type: Boolean, default: false },
  commissionEarned: { type: Number, default: 0 },
  commissionThisMonth: { type: Number, default: 0 },
  lastPayoutDate: Date,
  stripeConnectId: String,
  totalReferralEarnings: { type: Number, default: 0 },
  commissionHistory: {
    type: Map,
    of: Number,
    default: {},
  },

  // ✅ AI access
  hasAI: { type: Boolean, default: false },
  plan: { type: String, enum: ["Free", "Pro"], default: "Free" },

  // ✅ Billing status
  subscriptionStatus: {
    type: String,
    enum: ["active", "canceled"],
    default: "active",
  },

  // ✅ AI usage tracking
  aiUsage: {
    openAiCost: { type: Number, default: 0 },
    twilioCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
  },

  // ✅ Usage balance
  usageBalance: { type: Number, default: 0 },

  // ✅ Notifications
  notifications: {
    emailReminders: { type: Boolean, default: true },
    dripAlerts: { type: Boolean, default: true },
    bookingConfirmations: { type: Boolean, default: true },
  },

  // ✅ Country
  country: { type: String },

  // ✅ NEW: A2P / Twilio Messaging state
  a2p: {
    brandSid: String,
    brandStatus: String,
    campaignSid: String,
    campaignStatus: String,
    messagingServiceSid: String,
    messagingReady: { type: Boolean, default: false },
    lastSyncedAt: Date,
  },

  // ✅ NEW: numbers last sync timestamp
  numbersLastSyncedAt: Date,
});

/* 🔹 Indexes for speed + compliance checks */
UserSchema.index({ email: 1 }, { name: "user_email_idx" });
UserSchema.index(
  { "numbers.phoneNumber": 1 },
  { name: "user_numbers_phone_idx" },
);

const User =
  (mongoose.models.User as mongoose.Model<IUser>) ||
  mongoose.model<IUser>("User", UserSchema);

export default User;

// ✅ Utility
export async function getUserByEmail(email: string) {
  return await User.findOne({ email });
}
