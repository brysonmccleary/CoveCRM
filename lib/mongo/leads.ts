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

// ---- Auto-enroll helper (FIXED) ----
import Folder from "@/models/Folder";
import DripCampaign from "@/models/DripCampaign";
import DripEnrollmentModel from "@/models/DripEnrollment";

/**
 * Enrolls freshly-created leads into active campaigns assigned to the folder.
 * - Matches on folderId string OR folder name in DripCampaign.assignedFolders (string array).
 * - Idempotent via DripEnrollment unique index (leadId,campaignId,status active|paused).
 * - Sets nextSendAt=now so your scheduler can pick it up immediately.
 */
export async function autoEnrollNewLeads(params: {
  userEmail: string;
  folderId: string | Types.ObjectId;
  leadIds: (string | Types.ObjectId)[];
  source: "folder-bulk" | "sheet-bulk" | "manual-lead";
}) {
  if (!params.leadIds?.length) return;

  const fid = params.folderId instanceof Types.ObjectId ? params.folderId : new Types.ObjectId(params.folderId);
  const folder = await Folder.findOne({ _id: fid, userEmail: params.userEmail }).lean();
  if (!folder) return;

  const folderIdStr = String(fid);
  const folderName = (folder as any).name as string | undefined;

  // Build folder match ORs
  const folderMatch: any[] = [{ assignedFolders: folderIdStr }];
  if (folderName) folderMatch.push({ assignedFolders: folderName });

  // Find active campaigns that (match folder) AND (belong to user OR are global)
  const campaigns = await DripCampaign.find({
    isActive: true,
    $and: [
      { $or: folderMatch },
      { $or: [{ user: params.userEmail }, { isGlobal: true }] },
    ],
  }).lean();

  if (!campaigns.length) return;

  const now = new Date();
  const bulkOps: any[] = [];

  for (const leadId of params.leadIds) {
    for (const c of campaigns) {
      bulkOps.push({
        updateOne: {
          filter: { leadId, campaignId: c._id, status: { $in: ["active", "paused"] } },
          update: {
            $setOnInsert: {
              leadId,
              campaignId: c._id,
              userEmail: params.userEmail,
              status: "active",
              cursorStep: 0,
              nextSendAt: now,
              source: params.source,
              createdAt: now,
              updatedAt: now,
            },
            $set: { updatedAt: now },
          },
          upsert: true,
        },
      });
    }
  }

  if (bulkOps.length) {
    try {
      await (DripEnrollmentModel as any).bulkWrite(bulkOps, { ordered: false });
    } catch (e) {
      // Ignore duplicate key races; uniqueness is enforced by the index
      console.warn("autoEnrollNewLeads(): bulkWrite warning", (e as any)?.message || e);
    }
  }
}

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

  const inserted = await (models.Lead as mongoose.Model<any>).insertMany(mapped, { ordered: false });
  try {
    await autoEnrollNewLeads({
      userEmail,
      folderId: fid,
      leadIds: inserted.map((d: any) => d._id),
      source: "folder-bulk",
    });
  } catch (e) {
    console.warn("createLeadsFromCSV(): autoEnroll warning", (e as any)?.message || e);
  }
  return inserted;
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

  const inserted = await (models.Lead as mongoose.Model<any>).insertMany(parsed, { ordered: false });
  try {
    await autoEnrollNewLeads({
      userEmail,
      folderId: fid,
      leadIds: inserted.map((d: any) => d._id),
      source: "sheet-bulk",
    });
  } catch (e) {
    console.warn("createLeadsFromGoogleSheet(): autoEnroll warning", (e as any)?.message || e);
  }
  return inserted;
};

export default Lead;
