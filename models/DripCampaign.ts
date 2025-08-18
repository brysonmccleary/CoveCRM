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
    name: { type: String, required: true },
    type: { type: String, enum: ["sms", "email"], default: "sms" },
    isActive: { type: Boolean, default: true },
    assignedFolders: [{ type: String }],
    steps: [StepSchema],
    analytics: AnalyticsSchema,
    createdBy: { type: String, default: "admin" },
    comments: [CommentSchema],
    user: { type: String }, // Tie to logged-in user (optional for global)
    isGlobal: { type: Boolean, default: false }, // <-- NEW field
  },
  { timestamps: true },
);

export default mongoose.models.DripCampaign ||
  mongoose.model("DripCampaign", DripCampaignSchema);
