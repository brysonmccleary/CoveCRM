// /models/MobileDevice.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const MobileDeviceSchema = new Schema(
  {
    userEmail: { type: String, required: true, index: true },

    // Expo push token like "ExponentPushToken[xxx]"
    expoPushToken: { type: String, required: true },

    // "ios" | "android" | "unknown"
    platform: {
      type: String,
      enum: ["ios", "android", "unknown"],
      default: "unknown",
    },

    // Optional device identifier from the app (e.g. Device.osInternalBuildId)
    deviceId: { type: String },

    lastSeenAt: { type: Date, default: Date.now },

    // Soft-disable without deleting row
    disabled: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

export type MobileDeviceDoc = InferSchemaType<typeof MobileDeviceSchema>;

export default (models.MobileDevice as mongoose.Model<MobileDeviceDoc>) ||
  model<MobileDeviceDoc>("MobileDevice", MobileDeviceSchema);
