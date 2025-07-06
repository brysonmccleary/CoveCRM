import mongoose from "mongoose";

const DripCampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ["sms", "email"], default: "sms" },
    isActive: { type: Boolean, default: true },
    assignedFolders: [{ type: String }],
    steps: [
      {
        text: { type: String, required: true },
        day: { type: String, required: true },
        time: { type: String, default: "9:00 AM" },
        calendarLink: { type: String, default: "" }
      }
    ],
    analytics: {
      views: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      replies: { type: Number, default: 0 },
      unsubscribes: { type: Number, default: 0 }
    },
    createdBy: { type: String, default: "admin" },
    comments: [
      {
        user: { type: String },
        message: { type: String },
        createdAt: { type: Date, default: Date.now }
      }
    ]
  },
  { timestamps: true }
);

export default mongoose.models.DripCampaign || mongoose.model("DripCampaign", DripCampaignSchema);
