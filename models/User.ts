// models/User.ts
import mongoose, { Schema } from "mongoose";

export interface IUser {
  email: string;
  password?: string;
  name?: string;
  role?: "user" | "admin";
  createdAt?: Date;
  username?: string;

  agentPhone?: string;
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
    status?: string;
    country?: string;
    carrier?: string;
    capabilities?: { voice?: boolean; sms?: boolean; mms?: boolean };
    purchasedAt?: Date;
    messagingServiceSid?: string;
    friendlyName?: string;
  }[];

  assignedDrips?: string[];
  leadIds?: string[];

  googleSheets?: {
    accessToken: string;
    refreshToken: string;
    expiryDate: number;
    googleEmail?: string;
    sheets?: { sheetId: string; folderName: string }[];
    syncedSheets?: {
      spreadsheetId: string;
      title: string;
      sheetId?: number;
      headerRow?: number;
      mapping?: Record<string, string>;
      skip?: Record<string, boolean>;
      folderId?: mongoose.Types.ObjectId;
      folderName?: string;
      lastRowImported?: number;
      lastImportedAt?: Date;
    }[];
  };

  googleTokens?: {
    accessToken: string;
    refreshToken?: string;
    expiryDate?: number;
  };
  googleCalendar?: {
    accessToken: string;
    refreshToken?: string;
    expiryDate?: number;
  };

  calendarId?: string;
  bookingSettings?: {
    timezone: string;
    slotLength: number;
    bufferTime: number;
    workingHours: { [day: string]: { start: string; end: string } };
    maxPerDay: number;
    autoConfirm: boolean;
  };

  aiAssistantName?: string;

  referralCode?: string;

  /** 🔹 New, explicit referral fields */
  referredByCode?: string; // what user typed (house or affiliate code)
  referredByUserId?: mongoose.Types.ObjectId; // affiliate owner, when applicable

  /** (legacy) keep present if other code still reads it; don’t use for new writes */
  referredBy?: any;

  affiliateCode?: string;
  affiliateApproved?: boolean;
  commissionEarned?: number;
  commissionThisMonth?: number;
  lastPayoutDate?: Date;
  stripeConnectId?: string;
  totalReferralEarnings?: number;
  commissionHistory?: { [month: string]: number };

  hasAI?: boolean;
  plan?: "Free" | "Pro";
  subscriptionStatus?: "active" | "canceled";

  aiUsage?: { openAiCost: number; twilioCost: number; totalCost: number };

  /**
   * 🔹 AI Dialer usage is tracked completely separately from regular CRM usage.
   * - vendorCost: your raw Twilio/OpenAI cost for AI calls
   * - billedMinutes: total minutes you’ve billed them for AI
   * - billedAmount: total $ you’ve billed via AI dialer usage top-ups
   */
  aiDialerUsage?: {
    vendorCost: number;
    billedMinutes: number;
    billedAmount: number;
    lastChargedAt?: Date;
  };

  /**
   * 🔹 AI Dialer balance only: remaining $ of AI dialer credit.
   * Regular CRM dialer/SMS keeps using usageBalance via the existing tracker.
   */
  aiDialerBalance?: number;
  aiDialerLastTopUpAt?: Date;

  usageBalance?: number;

  notifications?: {
    emailReminders?: boolean;
    dripAlerts?: boolean;
    bookingConfirmations?: boolean;
    emailOnInboundSMS?: boolean;
  };

  country?: string;

  a2p?: {
    brandSid?: string;
    brandStatus?: string;
    campaignSid?: string;
    campaignStatus?: string;
    messagingServiceSid?: string;
    messagingReady?: boolean;
    lastSyncedAt?: Date;
  };

  twilio?: { accountSid?: string; apiKeySid?: string; apiKeySecret?: string };
  billingMode?: "platform" | "self";

  numbersLastSyncedAt?: Date;

  /** ⬇️ per-user dial progress */
  dialProgress?: {
    key: string;
    lastIndex: number;
    total?: number;
    updatedAt: Date;
  }[];
}

const SyncedSheetSchema = new Schema(
  {
    spreadsheetId: String,
    title: String,
    sheetId: Number,
    headerRow: { type: Number, default: 1 },
    mapping: { type: Schema.Types.Mixed, default: {} },
    skip: { type: Schema.Types.Mixed, default: {} },
    folderId: { type: Schema.Types.ObjectId, ref: "Folder" },
    folderName: String,
    lastRowImported: { type: Number, default: 1 },
    lastImportedAt: Date,
  },
  { _id: false },
);

const DialProgressSchema = new Schema(
  {
    key: { type: String, index: true },
    lastIndex: { type: Number, default: 0 },
    total: { type: Number },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true },
  password: { type: String },
  name: { type: String },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  createdAt: { type: Date, default: Date.now },
  username: { type: String },
  agentPhone: { type: String },
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
      status: String,
      country: String,
      carrier: String,
      capabilities: {
        voice: { type: Boolean },
        sms: { type: Boolean },
        mms: { type: Boolean },
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
    sheets: [{ sheetId: String, folderName: String }],
    syncedSheets: { type: [SyncedSheetSchema], default: [] },
  },

  googleTokens: {
    accessToken: String,
    refreshToken: String,
    expiryDate: Number,
  },
  googleCalendar: {
    accessToken: String,
    refreshToken: String,
    expiryDate: Number,
  },

  calendarId: String,
  bookingSettings: {
    timezone: { type: String, default: "America/Los_Angeles" },
    slotLength: { type: Number, default: 30 },
    bufferTime: { type: Number, default: 0 },
    workingHours: { type: Schema.Types.Mixed, default: {} },
    maxPerDay: { type: Number, default: 0 },
    autoConfirm: { type: Boolean, default: true },
  },

  aiAssistantName: { type: String, default: "Assistant" },

  referralCode: { type: String, unique: true, sparse: true },

  /** 🔹 New, explicit referral fields */
  referredByCode: { type: String, index: true, sparse: true },
  referredByUserId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    index: true,
    sparse: true,
  },

  /** (legacy) keep, but don’t write new values here */
  referredBy: { type: Schema.Types.Mixed },

  affiliateCode: String,
  affiliateApproved: { type: Boolean, default: false },
  commissionEarned: { type: Number, default: 0 },
  commissionThisMonth: { type: Number, default: 0 },
  lastPayoutDate: Date,
  stripeConnectId: String,
  totalReferralEarnings: { type: Number, default: 0 },
  commissionHistory: { type: Map, of: Number, default: {} },

  hasAI: { type: Boolean, default: false },
  plan: { type: String, enum: ["Free", "Pro"], default: "Free" },
  subscriptionStatus: {
    type: String,
    enum: ["active", "canceled"],
    default: "active",
  },

  aiUsage: {
    openAiCost: { type: Number, default: 0 },
    twilioCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
  },

  // 🔹 AI Dialer usage – completely separate from regular CRM usage.
  aiDialerUsage: {
    vendorCost: { type: Number, default: 0 },
    billedMinutes: { type: Number, default: 0 },
    billedAmount: { type: Number, default: 0 },
    lastChargedAt: { type: Date, default: null },
  },

  aiDialerBalance: { type: Number, default: 0 },
  aiDialerLastTopUpAt: { type: Date, default: null },

  usageBalance: { type: Number, default: 0 },

  notifications: {
    emailReminders: { type: Boolean, default: true },
    dripAlerts: { type: Boolean, default: true },
    bookingConfirmations: { type: Boolean, default: true },
    emailOnInboundSMS: { type: Boolean, default: true },
  },

  country: { type: String },

  a2p: {
    brandSid: String,
    brandStatus: String,
    campaignSid: String,
    campaignStatus: String,
    messagingServiceSid: String,
    messagingReady: { type: Boolean, default: false },
    lastSyncedAt: Date,
  },

  twilio: { accountSid: String, apiKeySid: String, apiKeySecret: String },
  billingMode: {
    type: String,
    enum: ["platform", "self"],
    default: "platform",
  },

  numbersLastSyncedAt: Date,

  dialProgress: { type: [DialProgressSchema], default: [] },
});

UserSchema.index({ email: 1 }, { name: "user_email_idx" });
UserSchema.index(
  { "numbers.phoneNumber": 1 },
  { name: "user_numbers_phone_idx" },
);
UserSchema.index(
  { "numbers.messagingServiceSid": 1 },
  { name: "user_numbers_msid_idx", sparse: true },
);
UserSchema.index(
  { "a2p.messagingServiceSid": 1 },
  { name: "user_a2p_msid_idx", sparse: true },
);
UserSchema.index(
  { "dialProgress.key": 1 },
  { name: "user_dial_progress_key_idx", sparse: true },
);

const User =
  (mongoose.models.User as mongoose.Model<IUser>) ||
  mongoose.model<IUser>("User", UserSchema);

export default User;

export async function getUserByEmail(email: string) {
  return await User.findOne({ email });
}
