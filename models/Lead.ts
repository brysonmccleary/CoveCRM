// /models/Lead.ts
import mongoose, { Schema, Types } from "mongoose";

/** Message directions your UI/logic expects */
export type InteractionType = "inbound" | "outbound" | "ai";

export interface IInteraction {
  type: InteractionType;
  text: string;
  date?: Date;

  // Twilio delivery & traceability (used by status-callback + auditing)
  sid?: string;               // Twilio SM... SID if applicable
  status?: string;            // queued | sent | delivered | failed | undelivered | etc.
  errorCode?: string;         // e.g. 30034, 30007

  // Routing info for outbound entries
  to?: string;                // E.164 destination for that message
  from?: string;              // specific number used, if any
  fromServiceSid?: string;    // Messaging Service SID (MG...)
  sentAt?: Date;              // when we attempted to send
}

export interface ITranscript {
  text: string;
  createdAt?: Date;
}

/** Tracks where a lead is inside a given drip */
export interface IDripProgress {
  dripId: string;        // DripCampaign _id (string) or slug used at assignment
  startedAt: Date;       // When Day 1 was sent/initialized
  lastSentIndex: number; // Index into steps[] that has been sent (0-based). -1 = none yet
}

/** 🔥 NEW: Generic history entry (Close-style activity feed) */
export type HistoryType =
  | "note"
  | "disposition"
  | "call"
  | "transcript"
  | "system";

export interface IHistoryEntry {
  type: HistoryType | string;   // keep flexible for backward compat
  message: string;              // human-readable text
  timestamp?: Date;             // when it happened (compat with older code)
  userEmail?: string;           // who performed the action
  meta?: Record<string, any>;   // optional extra context (duration, callSid, etc.)
}

export interface ILead {
  // Basic lead/contact fields
  State?: string;
  "First Name"?: string;
  "Last Name"?: string;
  Email?: string;
  Phone?: string;
  /** NEW: normalized last-10 digits used for de-dupe */
  phoneLast10?: string;
  Notes?: string;
  Age?: string;
  Beneficiary?: string;
  "Coverage Amount"?: string;

  // Ownership & organization
  userEmail: string;                // existing field your app already uses
  ownerEmail?: string;              // alias (mirrors userEmail)
  ownerId?: Types.ObjectId;         // user._id for precise ownership
  folderId?: Types.ObjectId;

  assignedDrips?: string[];
  /** scheduler state per assigned drip */
  dripProgress?: IDripProgress[];

  status?: string; // New / Booked / etc.

  // Conversation history (kept for quick UI rendering)
  interactionHistory?: IInteraction[];
  callTranscripts?: ITranscript[];

  /** 🔥 NEW: Close-style activity feed */
  history?: IHistoryEntry[];

  // AI engagement + scheduling
  isAIEngaged?: boolean;
  appointmentTime?: Date;
  aiLastResponseAt?: Date;

  // Reminder flags
  remindersSent?: {
    morning?: boolean;
    oneHour?: boolean;
    fifteenMin?: boolean;
  };

  // Lead type
  leadType?: "Final Expense" | "Veteran" | "Mortgage Protection" | "IUL";

  // Calendar / callback UX
  calendarEventId?: string;
  isInboundCallback?: boolean;
  callbackNotified?: boolean;

  // Compliance: subscription state
  unsubscribed?: boolean;
  optOutAt?: Date;
  consent?: {
    status?: "opted_in" | "opted_out" | "unknown";
    method?: string;
    timestamp?: Date;
    sourceUrl?: string;
    ip?: string;
    userAgent?: string;
  };

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

const InteractionSchema = new Schema<IInteraction>(
  {
    type: { type: String, enum: ["inbound", "outbound", "ai"], required: true },
    text: { type: String, required: true },
    date: { type: Date, default: Date.now },

    // Twilio delivery + traceability
    sid: { type: String },
    status: { type: String },
    errorCode: { type: String },

    // Routing info (mainly for outbound/ai)
    to: { type: String },
    from: { type: String },
    fromServiceSid: { type: String },
    sentAt: { type: Date },
  },
  { _id: false }
);

const TranscriptSchema = new Schema<ITranscript>(
  {
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/** 🔥 NEW: History entry schema (backward-compatible with existing uses in your code) */
const HistoryEntrySchema = new Schema<IHistoryEntry>(
  {
    type: { type: String, required: true },                 // note | disposition | call | transcript | system | ...
    message: { type: String, required: true },              // e.g., "Disposition: Sold", "Note: call back Monday"
    timestamp: { type: Date, default: Date.now },           // keep 'timestamp' name because some existing code uses it
    userEmail: { type: String },                            // author (lowercased)
    meta: { type: Schema.Types.Mixed },                     // arbitrary payload (duration, callSid, etc.)
  },
  { _id: false }
);

const DripProgressSchema = new Schema<IDripProgress>(
  {
    dripId: { type: String, required: true },
    startedAt: { type: Date, required: true },
    lastSentIndex: { type: Number, required: true, default: -1 },
  },
  { _id: false }
);

// Helper: extract normalized last 10 digits from any phone-ish string
function toLast10(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = String(phone).replace(/\D+/g, "");
  if (!digits) return undefined;
  return digits.slice(-10) || undefined;
}

const LeadSchema = new Schema<ILead>(
  {
    State: { type: String },
    "First Name": { type: String },
    "Last Name": { type: String },
    Email: { type: String },
    Phone: { type: String },
    /** NEW: normalized last-10 digits for de-duplication */
    phoneLast10: { type: String, index: true, sparse: true },
    Notes: { type: String },
    Age: { type: String },
    Beneficiary: { type: String },
    "Coverage Amount": { type: String },

    // 🔐 Ownership
    userEmail: { type: String, required: true, index: true },           // existing
    ownerEmail: { type: String, index: true },                           // mirrors userEmail
    ownerId: { type: Schema.Types.ObjectId, ref: "User", index: true },  // precise owner id
    folderId: { type: Schema.Types.ObjectId, ref: "Folder", index: true },

    assignedDrips: { type: [String], default: [] },

    /** per-drip scheduler state */
    dripProgress: { type: [DripProgressSchema], default: [] },

    status: { type: String, default: "New" },

    interactionHistory: { type: [InteractionSchema], default: [] },
    callTranscripts: { type: [TranscriptSchema], default: [] },

    /** 🔥 NEW: Close-style activity feed */
    history: { type: [HistoryEntrySchema], default: [] },

    isAIEngaged: { type: Boolean, default: false },
    appointmentTime: { type: Date },
    aiLastResponseAt: { type: Date },

    remindersSent: {
      type: {
        morning: { type: Boolean, default: false },
        oneHour: { type: Boolean, default: false },
        fifteenMin: { type: Boolean, default: false },
      },
      default: {},
    },

    leadType: {
      type: String,
      enum: ["Final Expense", "Veteran", "Mortgage Protection", "IUL"],
      default: "Final Expense",
    },

    // Calendar dedupe
    calendarEventId: { type: String },

    // Realtime callback UI helpers
    isInboundCallback: { type: Boolean, default: false },
    callbackNotified: { type: Boolean, default: false },

    // Compliance fields
    unsubscribed: { type: Boolean, default: false },
    optOutAt: { type: Date },
    consent: {
      status: { type: String, enum: ["opted_in", "opted_out", "unknown"], default: "unknown" },
      method: { type: String },
      timestamp: { type: Date },
      sourceUrl: { type: String },
      ip: { type: String },
      userAgent: { type: String },
    },
  },
  { timestamps: true }
);

/* 🔁 Compatibility guard:
   Ensure ownerEmail mirrors userEmail (and vice-versa if ownerEmail provided). */
LeadSchema.pre("save", function (next) {
  const doc = this as any;
  if (!doc.ownerEmail && doc.userEmail) doc.ownerEmail = doc.userEmail.toLowerCase();
  if (!doc.userEmail && doc.ownerEmail) doc.userEmail = doc.ownerEmail.toLowerCase();
  if (doc.ownerEmail) doc.ownerEmail = String(doc.ownerEmail).toLowerCase();
  if (doc.userEmail) doc.userEmail = String(doc.userEmail).toLowerCase();

  // compute phoneLast10 on save
  if (doc.Phone !== undefined) {
    const last10 = toLast10(doc.Phone);
    if (last10) doc.phoneLast10 = last10;
    else doc.phoneLast10 = undefined;
  }
  next();
});

/** Also compute phoneLast10 on findOneAndUpdate upserts/updates */
LeadSchema.pre("findOneAndUpdate", function (next) {
  const update: any = this.getUpdate() || {};
  const directPhone = update?.Phone;
  const setPhone = update?.$set?.Phone;

  const phone = directPhone ?? setPhone;
  if (phone !== undefined) {
    const last10 = toLast10(phone);
    if (update.$set) update.$set.phoneLast10 = last10;
    else update.phoneLast10 = last10;
    this.setUpdate(update);
  }
  next();
});

/* 🔍 Useful indexes for performance */
LeadSchema.index({ userEmail: 1, Phone: 1 });            // fast lookups by owner + phone (legacy)
LeadSchema.index({ userEmail: 1, phoneLast10: 1 }, { name: "lead_user_phoneLast10_idx", sparse: true });
LeadSchema.index({ userEmail: 1, Email: 1 }, { name: "lead_user_email_idx", sparse: true });
LeadSchema.index({ userEmail: 1, updatedAt: -1 });       // dashboard lists
LeadSchema.index({ ownerEmail: 1, updatedAt: -1 }, { name: "lead_ownerEmail_idx" }); // owner scans
LeadSchema.index({ "dripProgress.dripId": 1 }, { name: "lead_drip_progress_drip_idx" }); // scheduler scans
LeadSchema.index({ "history.timestamp": -1 }, { name: "lead_history_ts_idx" }); // quick history reads

export type LeadModel = mongoose.Model<ILead>;
export default (mongoose.models.Lead as LeadModel) ||
  mongoose.model<ILead>("Lead", LeadSchema);
