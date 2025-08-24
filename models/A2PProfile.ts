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

// High-level rollup used for dashboard + notifications
export type A2PApplicationStatus = "pending" | "approved" | "declined";

export interface IA2PProfile extends Document {
  // linkage
  userId: string;

  // ---- Business info collected from tenant ----
  businessName: string;
  ein: string;
  website: string;
  address: string;
  email: string;
  phone: string;
  contactTitle: string;
  contactFirstName: string;
  contactLastName: string;

  // ---- TrustHub/Profile ----
  profileSid: string; // Secondary Customer Profile (BU...)
  // extra TrustHub artifacts used by /api/a2p/start.ts
  businessEndUserSid?: string;
  authorizedRepEndUserSid?: string;
  trustProductSid?: string; // TP...
  a2pProfileEndUserSid?: string; // us_a2p_messaging_profile_information end user
  assignedToPrimary?: boolean; // secondary assigned to ISV primary

  // Optional legacy/use-case sid
  useCaseSid?: string;

  // ---- Campaign content & consent ----
  sampleMessages: string; // legacy string
  sampleMessagesArr?: string[]; // modern array variant
  optInDetails: string;
  volume: string;
  optInScreenshotUrl: string;

  // -------------------- ISV automation fields --------------------
  brandSid?: string; // BNxxxxxxxx
  campaignSid?: string; // (optional legacy)
  usa2pSid?: string; // QE/CM identifier created under Messaging Service
  messagingServiceSid?: string; // MGxxxxxxxx

  // Lifecycle + health
  registrationStatus?: A2PRegistrationStatus;
  messagingReady?: boolean;
  lastError?: string;

  // Rollup status + notifications
  applicationStatus?: A2PApplicationStatus;
  approvalNotifiedAt?: Date;
  declinedReason?: string;

  // Optional richer compliance content
  compliance?: {
    help?: string;
    stop?: string;
    optOutKeywords?: string[];
  };

  // Optional metrics / vetting details
  vettingScore?: number;
  lastSyncedAt?: Date;

  // Audit trail
  approvalHistory?: {
    stage: A2PRegistrationStatus | string;
    at: Date;
    note?: string;
  }[];

  // bookkeeping
  createdAt: Date;
  updatedAt?: Date;
}

const A2PProfileSchema = new Schema<IA2PProfile>({
  userId: { type: String, required: true, index: true },

  // Business info
  businessName: { type: String, required: true },
  ein: { type: String, required: true },
  website: { type: String, required: true },
  address: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  contactTitle: { type: String, required: true },
  contactFirstName: { type: String, required: true },
  contactLastName: { type: String, required: true },

  // TrustHub/Business profile (secondary)
  profileSid: { type: String, required: true },

  // Extra TrustHub artifacts you create/attach in /api/a2p/start
  businessEndUserSid: { type: String },
  authorizedRepEndUserSid: { type: String },
  trustProductSid: { type: String },
  a2pProfileEndUserSid: { type: String },
  assignedToPrimary: { type: Boolean },

  // Legacy/use-case
  useCaseSid: { type: String },

  // Consent & messaging details
  sampleMessages: { type: String, required: true },
  sampleMessagesArr: { type: [String], default: undefined },
  optInDetails: { type: String, required: true },
  volume: { type: String, required: true },
  optInScreenshotUrl: { type: String, required: true },

  // ISV artifacts
  brandSid: { type: String },
  campaignSid: { type: String },
  usa2pSid: { type: String },
  messagingServiceSid: { type: String },

  // Detailed lifecycle
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

  // High-level rollup + notification + decline reason
  applicationStatus: {
    type: String,
    enum: ["pending", "approved", "declined"],
    default: "pending",
    index: true,
  },
  approvalNotifiedAt: { type: Date },
  declinedReason: { type: String },

  // Optional richer compliance fields
  compliance: {
    help: { type: String },
    stop: { type: String },
    optOutKeywords: { type: [String], default: undefined },
  },

  vettingScore: { type: Number },
  lastSyncedAt: { type: Date },

  // Audit
  approvalHistory: [
    {
      stage: { type: String },
      at: { type: Date, default: Date.now },
      note: { type: String },
    },
  ],

  // bookkeeping
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// keep updatedAt fresh
A2PProfileSchema.pre("save", function (next) {
  (this as any).updatedAt = new Date();
  next();
});

export default (mongoose.models.A2PProfile as mongoose.Model<IA2PProfile>) ||
  mongoose.model<IA2PProfile>("A2PProfile", A2PProfileSchema);
