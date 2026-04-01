// models/FBLeadCampaign.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const FBLeadCampaignSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    leadType: {
      type: String,
      enum: ["final_expense", "iul", "mortgage_protection", "veteran", "trucker"],
      required: true,
      index: true,
    },
    campaignName: { type: String, required: true },
    status: {
      type: String,
      enum: ["setup", "active", "paused", "cancelled"],
      default: "setup",
      index: true,
    },
    facebookCampaignId: { type: String }, // Phase 2 — FB Ads Manager integration
    facebookPageId: { type: String, default: "" }, // FB Page ID for webhook matching
    googleSheetUrl: { type: String, default: "" }, // Google Sheet URL connected by agent
    appsScriptUrl: { type: String, default: "" }, // Apps Script web app URL for sheet writes
    lastSheetSyncAt: { type: Date },
    lastSyncedRow: { type: Number, default: 1 },
    dailyBudget: { type: Number, default: 0 },
    totalSpend: { type: Number, default: 0 },
    totalLeads: { type: Number, default: 0 },
    totalClicks: { type: Number, default: 0 },
    cpl: { type: Number, default: 0 }, // cost per lead
    setupCompletedAt: { type: Date },
    connectedAt: { type: Date },
    plan: {
      type: String,
      enum: ["manager", "manager_pro"],
      default: "manager",
    },
    notes: { type: String, default: "" },
    isDefault: { type: Boolean, default: false }, // receives unmatched webhook leads for this user
    folderId: { type: Schema.Types.ObjectId, ref: "Folder", default: null }, // linked CRM folder

    // Performance scoring fields
    metaCampaignId: { type: String, default: "" },
    metaAdsetId: { type: String, default: "" },
    objective: { type: String, default: "" }, // e.g. "LEAD_GENERATION"
    autoModeOn: { type: Boolean, default: false },
    targetCpl: { type: Number, default: 0 },
    targetCostPerBooked: { type: Number, default: 0 },
    targetCostPerSale: { type: Number, default: 0 },
    performanceScore: { type: Number, default: null },
    performanceClass: {
      type: String,
      enum: ["SCALE", "DUPLICATE_TEST", "MONITOR", "FIX", "PAUSE", null],
      default: null,
    },
    automationEnabled: { type: Boolean, default: false },
    lastAutomationActionAt: { type: Date, default: null },
    lastScoredAt: { type: Date },
    lastActionReport: { type: String, default: "" },
    lastActionReportAt: { type: Date },
    frequency: { type: Number, default: 0 },
    optOutRate: { type: Number, default: 0 },
    badNumberRate: { type: Number, default: 0 },
  },
  { timestamps: true }
);

FBLeadCampaignSchema.index({ userId: 1, status: 1 });
FBLeadCampaignSchema.index({ userId: 1, leadType: 1 });

export type FBLeadCampaign = InferSchemaType<typeof FBLeadCampaignSchema>;
export default (models.FBLeadCampaign as mongoose.Model<FBLeadCampaign>) ||
  model<FBLeadCampaign>("FBLeadCampaign", FBLeadCampaignSchema);
