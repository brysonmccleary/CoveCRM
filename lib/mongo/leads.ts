import mongoose, { Schema, model, models, Types } from "mongoose";

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

    // Ownership / scoping
    userEmail: { type: String, required: true },
    ownerEmail: { type: Schema.Types.Mixed }, // keep legacy docs readable; we no longer write to it

    // Folder linkage (canonical)
    folderId: { type: Schema.Types.ObjectId, ref: "Folder" },

    // Status / automation
    assignedDrips: { type: [String], default: [] },
    status: { type: String, default: "New" },

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

    // Lead type used by AI
    leadType: {
      type: String,
      enum: ["Final Expense", "Veteran", "Mortgage Protection", "IUL"],
      default: "Final Expense",
    },
  },
  { timestamps: true, strict: false }
);

// -------- Indexes --------
LeadSchema.index({ userEmail: 1, updatedAt: -1 }, { name: "lead_user_updated_desc" });
LeadSchema.index({ userEmail: 1, Phone: 1 }, { name: "lead_user_phone_idx" });
LeadSchema.index({ userEmail: 1, normalizedPhone: 1 }, { name: "lead_user_normalized_phone_idx" });
LeadSchema.index({ ownerEmail: 1, Phone: 1 }, { name: "lead_owner_phone_idx" }); // legacy reads OK
LeadSchema.index({ userEmail: 1, folderId: 1 }, { name: "lead_user_folder_idx" });
LeadSchema.index({ State: 1 }, { name: "lead_state_idx" });
LeadSchema.index({ userEmail: 1, isAIEngaged: 1, updatedAt: -1 }, { name: "lead_ai_engaged_idx" });

// -------- Utilities --------
export const sanitizeLeadType = (input: string): string => {
  const normalized = (input || "").toLowerCase().trim();
  if (normalized.includes("veteran") || normalized === "vet") return "Veteran";
  if (normalized.includes("mortgage")) return "Mortgage Protection";
  if (normalized.includes("iul")) return "IUL";
  return "Final Expense";
};

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

    return {
      ...rest,
      userEmail,
      folderId: fid,
      status: lead.status ?? "New",
      phoneLast10: lead.phoneLast10 ?? normalizedPhone?.slice(-10),
      normalizedPhone,
      Email: emailLower,
      email: emailLower2,
      leadType: sanitizeLeadType(lead.leadType || ""),
    };
  });

  return await Lead.insertMany(mapped, { ordered: false });
};

export const createLeadsFromGoogleSheet = async (
  sheetLeads: any[],
  userEmail: string,
  folderId: string | Types.ObjectId
) => {
  const fid = toObjectId(folderId);
  const parsed = sheetLeads.map((lead) => {
    const emailLower =
      typeof lead.Email === "string" ? lead.Email.toLowerCase().trim() : lead.Email;
    const emailLower2 =
      typeof lead.email === "string" ? lead.email.toLowerCase().trim() : lead.email;
    const normalizedPhone =
      lead.normalizedPhone ??
      (typeof lead.Phone === "string" ? lead.Phone.replace(/\D+/g, "") : undefined);

    const { ownerEmail, ...rest } = lead;

    return {
      ...rest,
      userEmail,
      folderId: fid,
      status: lead.status ?? "New",
      phoneLast10: lead.phoneLast10 ?? normalizedPhone?.slice(-10),
      normalizedPhone,
      Email: emailLower,
      email: emailLower2,
      leadType: sanitizeLeadType(lead.leadType || ""),
    };
  });

  return await Lead.insertMany(parsed, { ordered: false });
};

export default Lead;
