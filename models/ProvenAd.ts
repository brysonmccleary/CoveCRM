import mongoose, { Schema, models, model } from "mongoose";

const ProvenAdSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
    userEmail: { type: String, index: true, required: true },

    scope: {
      type: String,
      enum: ["user", "global"],
      default: "user",
      index: true,
    },

    sourceBrand: { type: String, default: "", index: true },
    sourceType: {
      type: String,
      enum: ["manual", "meta_ad_library", "landing_page", "video", "image", "other"],
      default: "manual",
      index: true,
    },
    sourceUrl: { type: String, default: "" },

    title: { type: String, required: true, trim: true, index: true },
    leadType: {
      type: String,
      enum: [
        "mortgage_protection",
        "final_expense",
        "veteran",
        "iul",
        "trucker",
        "medicare",
        "annuity",
        "custom",
      ],
      default: "custom",
      index: true,
    },
    format: {
      type: String,
      enum: ["video", "image", "carousel", "landing_page", "instant_form", "unknown"],
      default: "unknown",
      index: true,
    },

    angleTags: { type: [String], default: [] },
    hookType: { type: String, default: "" },
    audience: { type: String, default: "" },

    primaryText: { type: String, default: "" },
    headline: { type: String, default: "" },
    description: { type: String, default: "" },
    cta: { type: String, default: "" },

    transcript: { type: String, default: "" },
    visualNotes: { type: String, default: "" },
    landingPageType: {
      type: String,
      enum: ["instant_form", "hosted_funnel", "advertorial_quiz", "quote_page", "unknown"],
      default: "unknown",
    },
    funnelSteps: { type: [String], default: [] },
    landingPageNotes: { type: String, default: "" },

    whyItWorks: { type: String, default: "" },
    complianceNotes: { type: String, default: "" },

    screenshotUrls: { type: [String], default: [] },
    assetUrls: { type: [String], default: [] },

    cloneNotes: { type: String, default: "" },
    likelyWinnerScore: { type: Number, default: 0 },
    isSeeded: { type: Boolean, default: false },

    searchableText: { type: String, default: "", index: true },
  },
  {
    timestamps: true,
  }
);

ProvenAdSchema.index({ userEmail: 1, leadType: 1, createdAt: -1 });
ProvenAdSchema.index({ userEmail: 1, sourceBrand: 1, title: 1 }, { unique: false });

const ProvenAd = models.ProvenAd || model("ProvenAd", ProvenAdSchema);
export default ProvenAd;
