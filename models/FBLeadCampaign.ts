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
    facebookPageName: { type: String, default: "" },
    adAccountId: { type: String, default: "" },
    googleSheetUrl: { type: String, default: "" }, // Google Sheet URL connected by agent
    appsScriptUrl: { type: String, default: "" }, // Apps Script web app URL for sheet writes
    webhookKey: { type: String, default: "" },
    funnelSlug: { type: String, default: "", index: true },
    funnelStatus: {
      type: String,
      enum: ["draft", "active", "paused"],
      default: "draft",
      index: true,
    },
    funnelVersion: { type: String, default: "2026-04-production-v1" },
    landingPageConfig: { type: Schema.Types.Mixed, default: {} },
    publicAgentProfile: {
      displayName: { type: String, default: "" },
      businessName: { type: String, default: "" },
      phone: { type: String, default: "" },
      stateLabel: { type: String, default: "" },
      logoUrl: { type: String, default: "" },
      headshotUrl: { type: String, default: "" },
    },
    complianceProfile: {
      disclaimerText: { type: String, default: "" },
      consentText: { type: String, default: "" },
      privacyUrl: { type: String, default: "" },
      termsUrl: { type: String, default: "" },
    },
    licensedStates: { type: [String], default: [], index: true },
    borderStateBehavior: {
      type: String,
      enum: ["allow_with_warning", "block"],
      default: "block",
    },
    leadSheetType: {
      type: String,
      enum: ["mortgage", "final_expense", "veteran", "trucker", "iul", ""],
      default: "",
    },
    expectedSheetHeaders: { type: [String], default: [] },
    sheetHeaderValidationPassed: { type: Boolean, default: false },
    sheetLastValidatedAt: { type: Date },
    sheetValidationErrors: { type: [String], default: [] },
    sheetMappingProfile: { type: Schema.Types.Mixed, default: {} },
    writeLeadsToSheet: { type: Boolean, default: true },
    stateRestrictionNoticeAccepted: { type: Boolean, default: false },
    lastSheetSyncAt: { type: Date },
    lastSyncedRow: { type: Number, default: 1 },
    dailyBudget: { type: Number, default: 0 },
    accountBudgetCap: { type: Number, default: 0 },
    totalSpend: { type: Number, default: 0 },
    totalLeads: { type: Number, default: 0 },
    totalClicks: { type: Number, default: 0 },
    appointments: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },
    costPerAppointment: { type: Number, default: 0 },
    costPerSale: { type: Number, default: 0 },
    appointmentRate: { type: Number, default: 0 },
    closeRate: { type: Number, default: 0 },
    contactRate: { type: Number, default: 0 },
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
    performanceScore: { type: Number, default: 0 },
    creativeFatigue: { type: Boolean, default: false },
    leadQualityScore: { type: Number, default: 0 },
    recommendNewAd: { type: Boolean, default: false },
    recommendReplaceAd: { type: Boolean, default: false },
    lastRecommendationEmailAt: { type: Date, default: null },
    performanceClass: {
      type: String,
      enum: ["SCALE", "DUPLICATE_TEST", "MONITOR", "FIX", "PAUSE", null],
      default: null,
    },
    lastDuplicatedAt: { type: Date, default: null },
    duplicatedFromCampaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", default: null },
    autoPaused: { type: Boolean, default: false },
    creativeRefreshNeeded: { type: Boolean, default: false },
    automationEnabled: { type: Boolean, default: false },
    lastAutomationActionAt: { type: Date, default: null },
    lastScoredAt: { type: Date },
    lastActionReport: { type: String, default: "" },
    lastActionReportAt: { type: Date },
    frequency: { type: Number, default: 0 },
    optOutRate: { type: Number, default: 0 },
    badNumberRate: { type: Number, default: 0 },

    // Meta object IDs (publish output)
    metaAdId: { type: String, default: "" },
    metaFormId: { type: String, default: "" },

    // Publish diagnostics
    metaPublishStatus: {
      type: String,
      enum: ["not_attempted", "skipped_missing_meta_connection", "success", "failed"],
      default: "not_attempted",
    },
    metaPublishError: { type: String, default: "" },
    metaLastPublishAttemptAt: { type: Date, default: null },
    metaLastPublishSuccessAt: { type: Date, default: null },

    // Insights sync metadata
    metaLastSyncedAt: { type: Date, default: null },
    metaSyncStatus: {
      type: String,
      enum: ["never_synced", "synced", "sync_failed", "token_expired"],
      default: "never_synced",
    },
    metaSyncError: { type: String, default: "" },

    // Live Meta campaign health
    metaObjectHealth: {
      type: String,
      enum: ["healthy", "paused_on_meta", "missing_meta_ids", "token_expired", "sync_failed", "stale", "disconnected", "not_published"],
      default: "not_published",
    },
    metaEffectiveStatus: { type: String, default: "" },
    metaConfiguredStatus: { type: String, default: "" },
    metaDailyBudgetLive: { type: Number, default: 0 },

    // Synced aggregate metrics (complementing AdMetricsDaily)
    totalImpressions: { type: Number, default: 0 },
    totalReach: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    cpc: { type: Number, default: 0 },
    cpm: { type: Number, default: 0 },
  },
  { timestamps: true }
);

FBLeadCampaignSchema.index({ userId: 1, status: 1 });
FBLeadCampaignSchema.index({ userId: 1, leadType: 1 });

export type FBLeadCampaign = InferSchemaType<typeof FBLeadCampaignSchema>;
export default (models.FBLeadCampaign as mongoose.Model<FBLeadCampaign>) ||
  model<FBLeadCampaign>("FBLeadCampaign", FBLeadCampaignSchema);
