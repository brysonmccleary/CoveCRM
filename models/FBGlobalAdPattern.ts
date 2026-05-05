// models/FBGlobalAdPattern.ts
// Anonymized aggregate Facebook ad intelligence. Never stores user identity or lead PII.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const GenerationHintsSchema = new Schema(
  {
    preferredHeadlinePatterns: { type: [String], default: [] },
    preferredPrimaryTextPatterns: { type: [String], default: [] },
    preferredButtonLabels: { type: [String], default: [] },
    preferredBenefitBullets: { type: [String], default: [] },
    preferredImageStyleNotes: { type: [String], default: [] },
    preferredHooks: { type: [String], default: [] },
    antiPatterns: { type: [String], default: [] },
  },
  { _id: false }
);

const FBGlobalAdPatternSchema = new Schema(
  {
    leadType: { type: String, required: true, index: true },
    sourceType: { type: String, default: "facebook_lead", index: true },
    winningFamilyId: { type: String, default: "" },
    variationType: { type: String, default: "" },
    vendorStyleTag: { type: String, default: "" },
    creativeArchetype: { type: String, default: "" },
    pageType: { type: String, default: "" },
    hookType: { type: String, default: "direct_benefit" },
    bodyAngle: { type: String, default: "benefit_forward" },
    ctaStyle: { type: String, default: "" },
    buttonStyle: { type: String, default: "" },
    colorDirection: { type: String, default: "" },
    headlineTemplate: { type: String, default: "" },
    primaryTextTemplate: { type: String, default: "" },
    imagePromptStyle: { type: String, default: "" },
    offerType: { type: String, default: "quote" },
    emotionalAngle: { type: String, default: "neutral" },
    audienceAngle: { type: String, default: "" },
    qualifierAngle: { type: String, default: "none" },
    trustAngle: { type: String, default: "" },
    benefitFocus: { type: String, default: "" },
    urgencyAngle: { type: String, default: "" },
    complianceFlags: { type: [String], default: [] },
    patternFingerprint: { type: String, required: true, index: true },

    totalCampaigns: { type: Number, default: 0 },
    totalSpend: { type: Number, default: 0 },
    totalLeads: { type: Number, default: 0 },
    totalAppointments: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    avgCpl: { type: Number, default: 0 },
    avgCostPerAppointment: { type: Number, default: 0 },
    avgCostPerSale: { type: Number, default: 0 },
    avgContactRate: { type: Number, default: 0 },
    avgCloseRate: { type: Number, default: 0 },
    avgAppointmentRate: { type: Number, default: 0 },
    avgOptOutRate: { type: Number, default: 0 },
    avgBadNumberRate: { type: Number, default: 0 },
    avgFrequency: { type: Number, default: 0 },
    performanceScore: { type: Number, default: 0, index: true },
    confidenceScore: { type: Number, default: 0, index: true },
    status: {
      type: String,
      enum: ["learning", "promising", "winner", "fatigued", "paused", "archived"],
      default: "learning",
      index: true,
    },
    sampleSizeScore: { type: Number, default: 0 },
    generationHints: { type: GenerationHintsSchema, default: () => ({}) },
    sampledCampaignIds: {
      type: [Schema.Types.ObjectId],
      ref: "FBLeadCampaign",
      default: [],
      select: false,
    },
    lastSeenAt: { type: Date, default: () => new Date() },
    lastPromotedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

FBGlobalAdPatternSchema.index({ leadType: 1, status: 1, performanceScore: -1 });
FBGlobalAdPatternSchema.index({ leadType: 1, confidenceScore: -1 });
FBGlobalAdPatternSchema.index({ patternFingerprint: 1, leadType: 1 }, { unique: true });
FBGlobalAdPatternSchema.index({ updatedAt: -1 });

export type FBGlobalAdPattern = InferSchemaType<typeof FBGlobalAdPatternSchema>;
export default (models.FBGlobalAdPattern as mongoose.Model<FBGlobalAdPattern>) ||
  model<FBGlobalAdPattern>("FBGlobalAdPattern", FBGlobalAdPatternSchema);
