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

export interface IA2PProfile extends Document {
  // linkage
  userId: string;

  // ---- Business info collected from tenant (kept from your schema) ----
  businessName: string;
  ein: string;
  website: string;
  address: string;
  email: string;
  phone: string;
  contactTitle: string;
  contactFirstName: string;
  contactLastName: string;

  // ---- TrustHub/Profile (you already stored this) ----
  profileSid: string; // TH/Business Profile SID

  // Optional legacy/use-case sid you had
  useCaseSid?: string;

  // ---- Campaign content & consent (kept from your schema) ----
  sampleMessages: string;           // keep for backward compatibility
  optInDetails: string;
  volume: string;
  optInScreenshotUrl: string;

  // -------------------- NEW: ISV automation fields --------------------
  // A2P artifacts
  brandSid?: string;                // BNxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  campaignSid?: string;             // CMxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  messagingServiceSid?: string;     // MGxxxxxxxxxxxxxxxxxxxxxxxxxxxx

  // Registration lifecycle + health
  registrationStatus?: A2PRegistrationStatus;
  messagingReady?: boolean;         // true once campaign_approved and wired
  lastError?: string;

  // Optional richer compliance content
  compliance?: {
    help?: string;                  // e.g., "Reply HELP for help"
    stop?: string;                  // e.g., "Reply STOP to opt out"
    optOutKeywords?: string[];      // e.g., ["STOP","STOPALL","UNSUBSCRIBE","CANCEL","END","QUIT"]
  };

  // Optional modernized sample messages (array) while keeping your string
  sampleMessagesArr?: string[];

  // Audit trail (optional)
  approvalHistory?: { stage: A2PRegistrationStatus | string; at: Date; note?: string }[];

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

  // TrustHub/Business profile
  profileSid: { type: String, required: true },

  // Legacy/use-case
  useCaseSid: { type: String },

  // Consent & messaging details
  sampleMessages: { type: String, required: true },
  optInDetails: { type: String, required: true },
  volume: { type: String, required: true },
  optInScreenshotUrl: { type: String, required: true },

  // NEW: ISV artifacts
  brandSid: { type: String },
  campaignSid: { type: String },
  messagingServiceSid: { type: String },

  // NEW: Lifecycle
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

  // Optional richer compliance fields
  compliance: {
    help: { type: String },
    stop: { type: String },
    optOutKeywords: { type: [String], default: undefined },
  },

  // Optional modernized sample messages
  sampleMessagesArr: { type: [String], default: undefined },

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
