// models/DripCampaign.ts
import mongoose from "mongoose";

const StepSchema = new mongoose.Schema({
  text: { type: String, required: true },
  day: { type: String, required: true },
  time: { type: String, default: "9:00 AM" },
  calendarLink: { type: String, default: "" },
  views: { type: Number, default: 0 },
  responses: { type: Number, default: 0 },
});

const CommentSchema = new mongoose.Schema({
  user: { type: String },
  message: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const AnalyticsSchema = new mongoose.Schema({
  views: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  replies: { type: Number, default: 0 },
  unsubscribes: { type: Number, default: 0 },
});

const DripCampaignSchema = new mongoose.Schema(
  {
    // Display name for the campaign
    name: { type: String, required: true },

    // Optional stable key/slug for referencing in UI/history (non-unique to avoid migrations)
    // Example: "missed-appt-7d" or "birthday-sms"
    key: { type: String, trim: true, index: true },

    // Channel type
    type: { type: String, enum: ["sms", "email"], default: "sms" },

    // Current activation flag (keep existing shape)
    isActive: { type: Boolean, default: true },

    // Folders currently assigned to this campaign (existing behavior)
    assignedFolders: [{ type: String }],

    // Campaign steps (existing shape)
    steps: [StepSchema],

    // Rollup stats (existing shape)
    analytics: AnalyticsSchema,

    // Metadata (existing fields)
    createdBy: { type: String, default: "admin" },
    comments: [CommentSchema],

    // Tenant/user scope (existing + new for clarity)
    user: { type: String }, // some code paths already use this
    userEmail: { type: String, index: true }, // explicit tenant field for new custom drips

    // Global availability flag
    isGlobal: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.DripCampaign ||
  mongoose.model("DripCampaign", DripCampaignSchema);
