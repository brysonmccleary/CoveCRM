// models/CompetitorAd.ts
// Competitor ad intelligence database — richer structure than FBAdIntelligence
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const CompetitorAdSchema = new Schema(
  {
    leadType: {
      type: String,
      enum: ["final_expense", "iul", "mortgage_protection", "veteran", "trucker"],
      required: true,
      index: true,
    },

    // Ad copy
    hook: { type: String, default: "" },
    headline: { type: String, default: "" },
    primaryText: { type: String, default: "" },
    description: { type: String, default: "" },
    ctaButton: { type: String, default: "" },

    // Creative info
    imagePrompt: { type: String, default: "" },
    videoThumbnail: { type: String, default: "" },
    format: { type: String, enum: ["image", "video", "carousel", "unknown"], default: "unknown" },

    // Performance signals
    estimatedCpl: { type: Number, default: 0 },
    engagementLevel: { type: String, enum: ["low", "medium", "high", "viral"], default: "medium" },
    performanceRating: { type: Number, default: 3, min: 1, max: 5 },

    // Funnel info
    funnelType: { type: String, default: "" }, // e.g. "lead_form", "landing_page", "messenger"
    offer: { type: String, default: "" }, // e.g. "free quote", "free guide"

    // Meta info
    estimatedDurationDays: { type: Number, default: 0 }, // how long the ad has been running
    targetingNotes: { type: String, default: "" },
    scrapedFrom: { type: String, default: "" }, // URL or source
    scrapedAt: { type: Date, default: Date.now },
    active: { type: Boolean, default: true },
    notes: { type: String, default: "" },

    // Attribution
    addedBy: { type: String, default: "system" }, // "system" | userEmail
  },
  { timestamps: true }
);

CompetitorAdSchema.index({ leadType: 1, active: 1 });
CompetitorAdSchema.index({ leadType: 1, engagementLevel: 1 });

export type CompetitorAd = InferSchemaType<typeof CompetitorAdSchema>;
export default (models.CompetitorAd as mongoose.Model<CompetitorAd>) ||
  model<CompetitorAd>("CompetitorAd", CompetitorAdSchema);
