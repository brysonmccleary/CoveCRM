import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";

const RecruitingCampaignSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
    name: { type: String, required: true, trim: true },
    idealRecruit: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, index: true },
    planKey: { type: String, enum: ["growth", "growth_recruiting"], default: "growth_recruiting", index: true },
    platforms: [{ type: String, enum: ["linkedin", "instagram"], required: true }],
    actions: [{ type: String, enum: ["dm", "like_post", "like_story", "follow", "connect"], required: true }],
    engagementAudience: { type: String, enum: ["everyone", "women", "men"], default: "everyone" },
    platformActionSettings: {
      instagram: {
        like_post: { type: Boolean, default: true },
        like_story: { type: Boolean, default: true },
        follow: { type: Boolean, default: true },
        dm: { type: Boolean, default: true },
      },
      linkedin: {
        like_post: { type: Boolean, default: true },
        connect: { type: Boolean, default: true },
        dm: { type: Boolean, default: true },
      },
    },
    seedAccounts: [{ type: String, trim: true }],
    discoverySourceTypes: [{
      type: String,
      enum: ["university_college_athletes", "newly_licensed_insurance", "entry_level_sales_organizations", "emerging_entrepreneur_creators", "door_to_door_sales_organizations", "insurance_agencies_brokerages"],
    }],
    openingMessage: { type: String, default: "" },
    status: {
      type: String,
      enum: ["draft", "simulation_ready", "active", "paused", "archived"],
      default: "draft",
      index: true,
    },
    executionMode: { type: String, enum: ["simulation", "browser_companion", "hosted_cloud"], default: "simulation" },
    liveExecutionEnabled: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);

RecruitingCampaignSchema.index({ ownerEmail: 1, createdAt: -1 });

export type RecruitingCampaign = InferSchemaType<typeof RecruitingCampaignSchema>;
export default (models.RecruitingCampaign as mongoose.Model<RecruitingCampaign>) ||
  model<RecruitingCampaign>("RecruitingCampaign", RecruitingCampaignSchema);
