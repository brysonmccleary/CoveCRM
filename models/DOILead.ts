// models/DOILead.ts
// Master pool of licensed insurance agents scraped from state DOI websites.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const DOILeadSchema = new Schema(
  {
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    // Unique key across entire collection — one record per email address
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: { type: String, default: "" },
    state: { type: String, index: true },          // 2-letter state abbreviation
    licenseType: { type: String, default: "" },    // e.g. "Life", "Health", "Life & Health"
    licenseNumber: { type: String, default: "" },
    licenseStatus: { type: String, default: "" },  // e.g. "Active", "Expired"
    source: { type: String, default: "" },         // which state DOI / scraper produced this
    scrapedAt: { type: Date, default: () => new Date() },

    // Assignment tracking
    lastAssignedAt: { type: Date, index: true },
    lastAssignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    assignedCount: { type: Number, default: 0 },

    // 90-day cooldown after any assignment — prevents reassigning to different users too quickly
    cooldownUntil: { type: Date, index: true },

    // Global unsubscribe — honored by both platform sends and agent email campaigns
    globallyUnsubscribed: { type: Boolean, default: false, index: true },
    globallyUnsubscribedAt: { type: Date },

    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

DOILeadSchema.index({ state: 1, cooldownUntil: 1, globallyUnsubscribed: 1 });
DOILeadSchema.index({ lastAssignedAt: 1 });

export type DOILead = InferSchemaType<typeof DOILeadSchema>;
export default (models.DOILead as mongoose.Model<DOILead>) ||
  model<DOILead>("DOILead", DOILeadSchema);
