// lib/mongo/leads.ts
import mongoose, { Schema, model, models, Types } from "mongoose";
import { extractPhoneFromRow } from "@/lib/leads/phoneMapping";
import {
  applyTimezoneToUpdate,
  deriveLeadTimezone,
  isSoldStatus,
  withDerivedTimezone,
} from "@/lib/leads/foundationFields";
import { LEAD_TYPES, normalizeLeadType } from "@/lib/leads/leadTypes";
import Folder from "@/models/Folder";

const normalizeExternalId = (value: any): string | undefined => {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
};

const omitBlankExternalId = (doc: Record<string, any>): Record<string, any> => {
  const normalized = normalizeExternalId(doc["externalId"]);
  if (normalized) doc["externalId"] = normalized;
  else delete doc["externalId"];
  return doc;
};

// -------- Subdocuments --------
const InteractionSchema = new Schema(
  {
    type: { type: String, enum: ["inbound", "outbound", "ai", "status"], required: true },
    text: { type: String },
    from: { type: String },
    to: { type: String },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const TranscriptSchema = new Schema(
  {
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// -------- Main schema --------
const LeadSchema = new Schema(
  {
    // Common lead fields
    State: { type: String },
    "First Name": { type: String },
    "Last Name": { type: String },
    Email: { type: String },
    email: { type: String }, // lowercase mirror
    Phone: { type: String },
    phoneLast10: { type: String },
    normalizedPhone: { type: String },
    Notes: { type: String },
    Age: { type: String },
    Beneficiary: { type: String },
    "Coverage Amount": { type: String },
    "Requested Coverage": { type: String },
    DOB: { type: String },
    "Mortgage Balance": { type: String },
    "Mortgage Payment": { type: String },
    "Marital Status": { type: String },
    "Military Status": { type: String },
    "Military Branch": { type: String },
    "CDL Status": { type: String },
    "Health Issues": { type: String },
    "Household Income": { type: String },
    "Current Coverage": { type: String },
    "Reason Interested": { type: String },
    "Why Interested": { type: String },
    "IUL Goal": { type: String },
    "Best Time To Call": { type: String },
    preferredLanguage: { type: String, enum: ["", "English", "Spanish"], default: "" },

    // Ownership / scoping
    userEmail: { type: String, required: true },
    ownerEmail: { type: Schema.Types.Mixed }, // keep legacy docs readable; we no longer write to it

    // Folder linkage (canonical)
    folderId: { type: Schema.Types.ObjectId, ref: "Folder" },

    // Status / automation
    assignedDrips: { type: [String], default: [] },
    status: { type: String, default: "New" },
    soldAt: { type: Date, default: null, index: true },
    soldAtApproximate: { type: Boolean, default: false },
    reviewRequestSentAt: { type: Date, default: null },
    reviewRequestSendingAt: { type: Date, default: null },
    contactAttempts: { type: Number, default: 0 },
    lastContactedAt: { type: Date, default: null },
    timezone: { type: String, default: "" },

    // Engagement / transcripts
    interactionHistory: { type: [InteractionSchema], default: [] },
    callTranscripts: { type: [TranscriptSchema], default: [] },
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

    // Original import row (preserve custom CSV/Sheet columns)
    rawRow: { type: Schema.Types.Mixed },

    // External import identity (Google Sheets/webhooks)
    source: { type: String, default: "" },
    externalId: { type: String, set: normalizeExternalId, index: true },
    sheetMeta: {
      type: {
        sheetId: { type: String, default: "" },
        gid: { type: String, default: "" },
        tabName: { type: String, default: "" },
        receivedAt: { type: Date, default: null },
        ts: { type: Schema.Types.Mixed, default: null },
        connectionId: { type: String, default: "" },
        rowNumber: { type: Number, default: null },
      },
      default: {},
    },

    // Lead type used by AI
    leadType: {
      type: String,
      enum: LEAD_TYPES,
      default: "Final Expense",
    },

    // Meta (Facebook native webhook) fields
    metaLeadgenId: { type: String, index: true, sparse: true },
    metaFormId: { type: String, default: "" },
    metaAdId: { type: String, default: "" },
    metaCreativeId: { type: String, default: "" },
    metaVariantId: { type: String, default: "" },
    metaCreativeFamily: { type: String, default: "" },
    metaLeadEventId: { type: String, default: "", index: true },
    metaFbclid: { type: String, default: "" },
    metaFbc: { type: String, default: "" },
    metaFbp: { type: String, default: "" },
    metaUtm: { type: Schema.Types.Mixed, default: {} },
    metaAdsetId: { type: String, default: "" },
    metaCampaignId: { type: String, default: "" },
    metaPageId: { type: String, default: "" },
    metaCreatedTime: { type: Date },
    metaRawPayload: { type: String, default: "" },
    metaConsent: { type: Schema.Types.Mixed, default: {} },
    leadSource: { type: String, default: "" },

    // Sale revenue fields (agent-entered; Option B source of truth for Facebook ROAS)
    annualPremium: { type: Number, default: null },
    compPercentage: { type: Number, default: null },
    advancePercentage: { type: Number, default: null },
    grossCommissionRevenue: { type: Number, default: null },
    advanceRevenue: { type: Number, default: null },
    holdbackRevenue: { type: Number, default: null },
    // True when a Facebook-attributed lead was marked Sold without a premium yet (agent chose
    // "premium pending" instead of entering AP). While true, the sale is excluded from sales
    // counts/close-rate/cost-per-sale/ROAS. Cleared by record-sale.ts once a real premium lands.
    revenuePending: { type: Boolean, default: false },

    // AI First-Call tracking
    sourceType: {
      type: String,
      enum: ["csv_import", "facebook_lead", "facebook_funnel", "form_submission", "api_live", "manual_live", "google_sheets_live", "vendor_api", "doi_prospecting", "manual_import", "kayla_landing_page"],
      default: "manual_live",
    },
    realTimeEligible: { type: Boolean, default: false },
    aiFirstCallAttemptedAt: { type: Date, default: null },
    aiFirstCallDueAt: { type: Date, default: null },
    aiFirstCallTriggeredAt: { type: Date, default: null }, // set when voice server confirms the call was placed
    aiFirstCallStatus: {
      type: String,
      enum: ["pending", "scheduled", "triggered", "failed", "stale_cleared", "aborted_dnc", "aborted_booked"],
      default: null,
    },
    aiContactAttemptedAt: { type: Date, default: null },
    aiConversationActive: { type: Boolean, default: false },
    aiPriorityScore: { type: Number, default: 0 },
    aiPriorityCategory: {
      type: String,
      enum: ["hot", "warm", "cold"],
      default: "cold",
    },
    aiPriorityUpdatedAt: { type: Date },
  },
  { timestamps: true, strict: false }
);

// -------- Indexes --------
LeadSchema.index({ userEmail: 1, updatedAt: -1 }, { name: "lead_user_updated_desc" });
LeadSchema.index({ userEmail: 1, Phone: 1 }, { name: "lead_user_phone_idx" });

// ✅ HARD DEDUPE (per user + folder) by normalizedPhone (only if normalizedPhone exists & not empty)
LeadSchema.index(
  { userEmail: 1, folderId: 1, normalizedPhone: 1 },
  {
    name: "lead_user_folder_normalized_phone_unique",
    unique: true,
    partialFilterExpression: {
      normalizedPhone: { $type: "string", $ne: "" },
      folderId: { $type: "objectId" },
    },
  }
);

// ✅ HARD DEDUPE (per user + folder) by lowercase email mirror (only if email exists & not empty)
LeadSchema.index(
  { userEmail: 1, folderId: 1, email: 1 },
  {
    name: "lead_user_folder_email_unique",
    unique: true,
    partialFilterExpression: {
      email: { $type: "string", $ne: "" },
      folderId: { $type: "objectId" },
    },
  }
);

LeadSchema.index({ ownerEmail: 1, Phone: 1 }, { name: "lead_owner_phone_idx" }); // legacy reads OK
LeadSchema.index({ userEmail: 1, folderId: 1 }, { name: "lead_user_folder_idx" });
LeadSchema.index({ State: 1 }, { name: "lead_state_idx" });
LeadSchema.index({ userEmail: 1, soldAt: -1 }, { name: "lead_user_sold_at_desc" });
LeadSchema.index({ userEmail: 1, lastContactedAt: 1 }, { name: "lead_user_last_contacted_asc" });
LeadSchema.index({ userEmail: 1, timezone: 1 }, { name: "lead_user_timezone_idx" });
LeadSchema.index({ userEmail: 1, isAIEngaged: 1, updatedAt: -1 }, { name: "lead_ai_engaged_idx" });
LeadSchema.index({ aiFirstCallStatus: 1, aiFirstCallDueAt: 1 }, { name: "lead_ai_first_call_due_idx", sparse: true });
LeadSchema.index(
  { userEmail: 1, externalId: 1 },
  {
    name: "lead_user_external_id_unique",
    unique: true,
    partialFilterExpression: {
      externalId: { $type: "string", $ne: "" },
    },
  }
);

// Meta lead dedup — sparse unique so null/empty doesn't conflict
LeadSchema.index(
  { metaLeadgenId: 1 },
  { name: "lead_meta_leadgen_id_unique", unique: true, sparse: true }
);

LeadSchema.pre("validate", function (next) {
  const doc = this as any;
  const timezone = deriveLeadTimezone(doc);
  if (timezone && (!doc.timezone || doc.isModified("State") || doc.isModified("state"))) {
    doc.timezone = timezone;
  }
  if (doc.isNew && isSoldStatus(doc.status) && !doc.soldAt) {
    doc.soldAt = new Date();
    doc.soldAtApproximate = false;
  }
  next();
});

function applyLeadFoundationUpdateFields(this: any, next: (err?: any) => void) {
  const update = this.getUpdate?.();
  if (update && !Array.isArray(update)) {
    this.setUpdate(applyTimezoneToUpdate(update));
  }
  next();
}

LeadSchema.pre("updateOne", applyLeadFoundationUpdateFields);
LeadSchema.pre("findOneAndUpdate", applyLeadFoundationUpdateFields);
LeadSchema.pre("updateMany", applyLeadFoundationUpdateFields);

// -------- Utilities --------
export const sanitizeLeadType = (input: string): string => {
  return normalizeLeadType(input) || "Final Expense";
};

/**
 * Pure decision: what leadType should this imported row end up with?
 * An explicit, non-blank row value always wins (sanitized). Otherwise falls
 * back to the folder's default, if the folder has one; otherwise the same
 * "Final Expense" fallback sanitizeLeadType has always produced.
 */
export function resolveLeadTypeForImport(rawRowLeadType: unknown, folderLeadTypeDefault: string | null): string {
  const raw = String(rawRowLeadType || "").trim();
  if (raw) return sanitizeLeadType(raw);
  return folderLeadTypeDefault || "Final Expense";
}

/**
 * Fetches a folder's leadType default (if set) for use as a fallback when an
 * incoming lead doesn't specify its own leadType. Never overrides an explicit
 * value — callers only use this when the lead's own leadType is blank.
 */
async function getFolderLeadTypeDefault(folderId: Types.ObjectId): Promise<string | null> {
  try {
    const folderDoc = await (Folder as any).findById(folderId).select({ leadType: 1 }).lean();
    const value = String(folderDoc?.leadType || "").trim();
    return value && (LEAD_TYPES as readonly string[]).includes(value) ? value : null;
  } catch {
    return null;
  }
}

const Lead = (models.Lead as mongoose.Model<any>) || model("Lead", LeadSchema);

// ---- CRUD helpers ----
export const getLeadById = async (leadId: string) => {
  return await Lead.findById(leadId);
};

export const updateLeadById = async (leadId: string, update: any) => {
  return await Lead.findByIdAndUpdate(leadId, update, { new: true });
};

export const deleteLeadById = async (leadId: string) => {
  return await Lead.findByIdAndDelete(leadId);
};

// Ensure ObjectId for folderId on any bulk creation path.
function toObjectId(id: string | Types.ObjectId): Types.ObjectId {
  return id instanceof Types.ObjectId ? id : new Types.ObjectId(id);
}

// These helpers accept already-normalized rows; we only guarantee folderId typing & defaults here.
export const createLeadsFromCSV = async (
  leads: any[],
  userEmail: string,
  folderId: string | Types.ObjectId
) => {
  const fid = toObjectId(folderId);
  const folderLeadType = await getFolderLeadTypeDefault(fid);

  const mapped = leads.map((lead) => {
    const emailLower =
      typeof lead.Email === "string" ? lead.Email.toLowerCase().trim() : lead.Email;
    const emailLower2 =
      typeof lead.email === "string" ? lead.email.toLowerCase().trim() : lead.email;

    const normalizedPhone =
      lead.normalizedPhone ??
      (typeof lead.Phone === "string" ? lead.Phone.replace(/\D+/g, "") : undefined);

    // never write ownerEmail in new docs
    const { ownerEmail, ...rest } = lead;

    const leadType = resolveLeadTypeForImport(lead.leadType, folderLeadType);

    return omitBlankExternalId(withDerivedTimezone({
      ...rest,
      userEmail,
      folderId: fid,
      status: lead.status ?? "New",
      phoneLast10: lead.phoneLast10 ?? normalizedPhone?.slice(-10),
      normalizedPhone,
      Email: emailLower,
      email: emailLower2 ?? emailLower, // ✅ ensure lowercase mirror exists
      leadType,
    }));
  });

  // ordered:false lets Mongo insert what it can and skip dup key rows
  return await Lead.insertMany(mapped, { ordered: false });
};

export const createLeadsFromGoogleSheet = async (
  sheetLeads: any[],
  userEmail: string,
  folderId: string | Types.ObjectId
) => {
  const fid = toObjectId(folderId);
  const folderLeadType = await getFolderLeadTypeDefault(fid);

  const parsed = sheetLeads.map((lead) => {
    const emailLower =
      typeof lead.Email === "string" ? lead.Email.toLowerCase().trim() : lead.Email;
    const emailLower2 =
      typeof lead.email === "string" ? lead.email.toLowerCase().trim() : lead.email;

    const rowPhone = extractPhoneFromRow(lead.rawRow || lead);
    const phone = lead.phone || rowPhone.phone;
    const normalizedPhone = lead.normalizedPhone || rowPhone.normalizedPhone;

    const { ownerEmail, ...rest } = lead;

    const leadType = resolveLeadTypeForImport(lead.leadType, folderLeadType);

    return omitBlankExternalId(withDerivedTimezone({
      ...rest,
      userEmail,
      folderId: fid,
      status: lead.status ?? "New",
      phone: phone || undefined,
      phoneLast10: lead.phoneLast10 ?? phone?.slice(-10) ?? normalizedPhone?.slice(-10),
      normalizedPhone,
      Email: emailLower,
      email: emailLower2 ?? emailLower, // ✅ ensure lowercase mirror exists
      leadType,
    }));
  });

  // ordered:false lets Mongo insert what it can and skip dup key rows
  return await Lead.insertMany(parsed, { ordered: false });
};

export default Lead;
