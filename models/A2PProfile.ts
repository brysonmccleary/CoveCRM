// /models/A2PProfile.ts
import mongoose, { Schema, Document } from "mongoose";

export type A2PRegistrationStatus =
  | "not_started"
  | "brand_submitted"
  | "brand_approved"
  | "campaign_submitted"
  | "campaign_approved"
  | "ready"
  | "rejected";

export type A2PApplicationStatus = "pending" | "approved" | "declined";

export interface IA2PProfile extends Document {
  userId: string;
  userEmail?: string;

  businessName: string;
  ein: string;
  website: string;

  address: string;
  addressLine2?: string;
  addressCity: string;
  addressState: string;
  addressPostalCode: string;
  addressCountry: string;

  email: string;
  phone: string;
  contactTitle: string;
  contactFirstName: string;
  contactLastName: string;

  profileSid: string;
  businessEndUserSid?: string;
  authorizedRepEndUserSid?: string;
  trustProductSid?: string;
  a2pProfileEndUserSid?: string;

  assignedToPrimary?: boolean;

  addressSid?: string;
  supportingDocumentSid?: string;

  parentAddressSid?: string;

  supportingDocumentCreatedVia?: "subaccount" | "parent";
  supportingDocumentAccountSid?: string;

  useCaseSid?: string;
  usecaseCode?: string;

  sampleMessages: string;
  sampleMessagesArr?: string[];
  optInDetails: string;
  volume: string;
  optInScreenshotUrl?: string;

  landingOptInUrl?: string;
  landingTosUrl?: string;
  landingPrivacyUrl?: string;

  brandSid?: string;
  campaignSid?: string; // QE...
  usa2pSid?: string; // (legacy, keep)
  messagingServiceSid?: string;

  brandStatus?: string;
  brandFailureReason?: string;

  brandErrors?: any[];
  brandErrorsText?: string;

  registrationStatus?: A2PRegistrationStatus;
  messagingReady?: boolean;
  lastError?: string;

  applicationStatus?: A2PApplicationStatus;
  approvalNotifiedAt?: Date;
  declinedReason?: string;
  declineNotifiedAt?: Date;

  lastSubmittedAt?: Date;
  lastSubmittedUseCase?: string;
  lastSubmittedOptInDetails?: string;
  lastSubmittedSampleMessages?: string[];
  lastSubmittedInputs?: any;

  twilioAccountSidLastUsed?: string;

  compliance?: {
    help?: string;
    stop?: string;
    optOutKeywords?: string[];
  };

  vettingScore?: number;
  lastSyncedAt?: Date;

  approvalHistory?: {
    stage: A2PRegistrationStatus | string;
    at: Date;
    note?: string;
  }[];

  // ✅ NEW: campaign-catcher idempotency + throttle (additive fields)
  campaignSubmitLockUntil?: Date;
  campaignSubmitLastAttemptAt?: Date;
  campaignSubmitAttempts?: number;

  createdAt: Date;
  updatedAt?: Date;
}

const A2PProfileSchema = new Schema<IA2PProfile>({
  userId: { type: String, required: true, index: true },
  userEmail: { type: String, index: true },

  businessName: { type: String, required: true },
  ein: { type: String, required: true },
  website: { type: String, required: true },

  address: { type: String, required: true },
  addressLine2: { type: String },
  addressCity: { type: String, required: true },
  addressState: { type: String, required: true },
  addressPostalCode: { type: String, required: true },
  addressCountry: { type: String, required: true },

  email: { type: String, required: true },
  phone: { type: String, required: true },
  contactTitle: { type: String, required: true },
  contactFirstName: { type: String, required: true },
  contactLastName: { type: String, required: true },

  profileSid: { type: String, required: true },

  businessEndUserSid: { type: String },
  authorizedRepEndUserSid: { type: String },
  trustProductSid: { type: String },
  a2pProfileEndUserSid: { type: String },

  assignedToPrimary: { type: Boolean },

  addressSid: { type: String },
  supportingDocumentSid: { type: String },

  parentAddressSid: { type: String },

  supportingDocumentCreatedVia: { type: String, enum: ["subaccount", "parent"] },
  supportingDocumentAccountSid: { type: String },

  useCaseSid: { type: String },
  usecaseCode: { type: String },

  sampleMessages: { type: String, required: true },
  sampleMessagesArr: { type: [String], default: undefined },
  optInDetails: { type: String, required: true },
  volume: { type: String, required: true },
  optInScreenshotUrl: { type: String },

  landingOptInUrl: { type: String },
  landingTosUrl: { type: String },
  landingPrivacyUrl: { type: String },

  brandSid: { type: String },
  campaignSid: { type: String },
  usa2pSid: { type: String },
  messagingServiceSid: { type: String },

  brandStatus: { type: String },
  brandFailureReason: { type: String },

  brandErrors: { type: [Schema.Types.Mixed], default: undefined },
  brandErrorsText: { type: String },

  registrationStatus: {
    type: String,
    enum: [
      "not_started",
      "brand_submitted",
      "brand_approved",
      "campaign_submitted",
      "campaign_approved",
      "ready",
      "rejected",
    ],
    default: "not_started",
  },

  messagingReady: { type: Boolean, default: false },
  lastError: { type: String },

  applicationStatus: {
    type: String,
    enum: ["pending", "approved", "declined"],
    default: "pending",
    index: true,
  },

  approvalNotifiedAt: { type: Date },
  declinedReason: { type: String },
  declineNotifiedAt: { type: Date },

  lastSubmittedAt: { type: Date },
  lastSubmittedUseCase: { type: String },
  lastSubmittedOptInDetails: { type: String },
  lastSubmittedSampleMessages: { type: [String], default: undefined },
  lastSubmittedInputs: { type: Schema.Types.Mixed },

  twilioAccountSidLastUsed: { type: String },

  compliance: {
    help: { type: String },
    stop: { type: String },
    optOutKeywords: { type: [String], default: undefined },
  },

  vettingScore: { type: Number },
  lastSyncedAt: { type: Date },

  approvalHistory: [
    {
      stage: { type: String },
      at: { type: Date, default: Date.now },
      note: { type: String },
    },
  ],

  // ✅ NEW lock fields
  campaignSubmitLockUntil: { type: Date },
  campaignSubmitLastAttemptAt: { type: Date },
  campaignSubmitAttempts: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

A2PProfileSchema.index({ userId: 1 }, { unique: true });

A2PProfileSchema.pre("save", function (next) {
  (this as any).updatedAt = new Date();
  next();
});

export default (mongoose.models.A2PProfile as mongoose.Model<IA2PProfile>) ||
  mongoose.model<IA2PProfile>("A2PProfile", A2PProfileSchema);
