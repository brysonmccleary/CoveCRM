// models/AISettings.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const AISettingsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    userEmail: { type: String, required: true, index: true, unique: true },
    // Feature toggles
    aiTextingEnabled: { type: Boolean, default: false },
    aiNewLeadCallEnabled: { type: Boolean, default: false },
    aiDialSessionEnabled: { type: Boolean, default: false },
    aiCallOverviewEnabled: { type: Boolean, default: true },
    aiCallCoachingEnabled: { type: Boolean, default: false },
    liveTransferEnabled: { type: Boolean, default: false },
    liveTransferPhone: { type: String, default: "" },
    // New lead call config
    newLeadCallDelayMinutes: { type: Number, default: 5, min: 0, max: 60 },
    // Business hours
    businessHoursOnly: { type: Boolean, default: true },
    businessHoursStart: { type: String, default: "09:00" },
    businessHoursEnd: { type: String, default: "18:00" },
    businessHoursTimezone: { type: String, default: "America/Phoenix" },
  },
  { timestamps: true }
);

export type AISettingsDoc = InferSchemaType<typeof AISettingsSchema>;
export default (models.AISettings as mongoose.Model<AISettingsDoc>) ||
  model<AISettingsDoc>("AISettings", AISettingsSchema);
