import mongoose, { Schema, model, models } from "mongoose";

// Interaction History Schema
const InteractionSchema = new Schema({
  type: { type: String, enum: ["inbound", "outbound", "ai"], required: true },
  text: { type: String, required: true },
  date: { type: Date, default: Date.now },
});

// Call Transcript Schema
const TranscriptSchema = new Schema({
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Main Lead Schema
const LeadSchema = new Schema(
  {
    State: { type: String },
    "First Name": { type: String },
    "Last Name": { type: String },
    Email: { type: String },
    Phone: { type: String },
    Notes: { type: String },
    Age: { type: String },
    Beneficiary: { type: String },
    "Coverage Amount": { type: String },

    userEmail: { type: String, required: true },
    folderId: { type: Schema.Types.ObjectId, ref: "Folder" },

    assignedDrips: { type: [String], default: [] },
    status: { type: String, default: "New" },

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

    // NEW: Lead Type used in AI
    leadType: {
      type: String,
      enum: ["Final Expense", "Veteran", "Mortgage Protection", "IUL"],
      default: "Final Expense",
    },
  },
  { timestamps: true }
);

// -----------------------------
// Utility Functions for Imports
// -----------------------------

export const sanitizeLeadType = (input: string): string => {
  const normalized = input.toLowerCase().trim();

  if (normalized.includes("veteran") || normalized === "vet") return "Veteran";
  if (normalized.includes("mortgage")) return "Mortgage Protection";
  if (normalized.includes("iul")) return "IUL";
  return "Final Expense"; // default
};

const Lead = models.Lead || model("Lead", LeadSchema);

// -----------------------------
// CRUD Functions
// -----------------------------

export const getLeadById = async (leadId: string) => {
  return await Lead.findById(leadId);
};

export const updateLeadById = async (leadId: string, update: any) => {
  return await Lead.findByIdAndUpdate(leadId, update, { new: true });
};

export const deleteLeadById = async (leadId: string) => {
  return await Lead.findByIdAndDelete(leadId);
};

export const createLeadsFromCSV = async (leads: any[], userEmail: string, folderId: string) => {
  const mapped = leads.map((lead) => ({
    ...lead,
    userEmail,
    folderId,
    status: "New",
    leadType: sanitizeLeadType(lead["Lead Type"] || ""),
  }));

  return await Lead.insertMany(mapped);
};

export const createLeadsFromGoogleSheet = async (sheetLeads: any[], userEmail: string, folderId: string) => {
  const parsed = sheetLeads.map((lead) => ({
    ...lead,
    userEmail,
    folderId,
    status: "New",
    leadType: sanitizeLeadType(lead["Lead Type"] || ""),
  }));

  return await Lead.insertMany(parsed);
};

export default Lead;
