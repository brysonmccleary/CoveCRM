// models/A2PProfile.ts
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
  ein: string; // display format (e.g. 00-0000000)
  website: string;

  // full address fields from the A2P form
  address: string; // street line 1
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

  // ---- TrustHub/Profile ----
  profileSid: string; // Secondary Customer Profile (BU...)
  // extra TrustHub artifacts used by /api/a2p/start.ts
  businessEndUserSid?: string;
  authorizedRepEndUserSid?: string;
  trustProductSid?: string; // TP...
  a2pProfileEndUserSid?: string; // us_a2p_messaging_profile_information end user
  assignedToPrimary?: boolean; // secondary assigned to ISV primary

  // Address-related TrustHub artifacts
  addressSid?: string; // AD...
  supportingDocumentSid?: string; // SD... (customer_profile_address)

  // Optional legacy/use-case sid
  useCaseSid?: string;

  // ✅ selected use case code (persisted for UX + /submit-campaign default)
  usecaseCode?: string;

  // ---- Campaign content & consent ----
  sampleMessages: string; // legacy string
  sampleMessagesArr?: string[]; // modern array variant
  optInDetails: string;
  volume: string;
  // ⬇️ made optional
  optInScreenshotUrl?: string;

  // ✅ Optional public links (for reviewer convenience)
  landingOptInUrl?: string;
  landingTosUrl?: string;
  landingPrivacyUrl?: string;

  // -------------------- ISV automation fields --------------------
  brandSid?: string; // BNxxxxxxxx
  campaignSid?: string; // (optional legacy)
  usa2pSid?: string; // QE/CM identifier created under Messaging Service
  messagingServiceSid?: string; // MGxxxxxxxx

  // Twilio / TCR brand state and failure info
  brandStatus?: string;
  brandFailureReason?: string; // flattened for UI

  // Lifecycle + health
  registrationStatus?: A2PRegistrationStatus;
  messagingReady?: boolean;
  lastError?: string;

  // Rollup status + notifications
  applicationStatus?: A2PApplicationStatus;
  approvalNotifiedAt?: Date;
  declinedReason?: string;
  declineNotifiedAt?: Date; // ✅ new: when we sent a decline email for the latest decline

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
  // stored as a display string: 00-0000000
  ein: { type: String, required: true },
  website: { type: String, required: true },

  // Full address fields
  address: { type: String, required: true }, // line 1
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

  // TrustHub/Business profile (secondary)
  profileSid: { type: String, required: true },

  // Extra TrustHub artifacts you create/attach in /api/a2p/start
  businessEndUserSid: { type: String },
  authorizedRepEndUserSid: { type: String },
  trustProductSid: { type: String },
  a2pProfileEndUserSid: { type: String },
  assignedToPrimary: { type: Boolean },

  // Address / SupportingDocument artifacts
  addressSid: { type: String },
  supportingDocumentSid: { type: String },

  // Legacy/use-case
  useCaseSid: { type: String },

  // ✅ Persisted selected use case
  usecaseCode: { type: String },

  // Consent & messaging details
  sampleMessages: { type: String, required: true },
  sampleMessagesArr: { type: [String], default: undefined },
  optInDetails: { type: String, required: true },
  volume: { type: String, required: true },
  // ⬇️ no longer required
  optInScreenshotUrl: { type: String },

  // ✅ Optional public links
  landingOptInUrl: { type: String },
  landingTosUrl: { type: String },
  landingPrivacyUrl: { type: String },

  // ISV artifacts
  brandSid: { type: String },
  campaignSid: { type: String },
  usa2pSid: { type: String },
  messagingServiceSid: { type: String },

  // Brand status / failure info from Twilio
  brandStatus: { type: String },
  brandFailureReason: { type: String },

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
  declineNotifiedAt: { type: Date }, // ✅ new

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
