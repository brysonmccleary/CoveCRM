// /models/MobileVoipDevice.ts
import mongoose, { Schema, Model, Document } from "mongoose";

export interface IMobileVoipDevice extends Document {
  userEmail: string;
  deviceId: string;
  platform: "ios" | "android";
  voipToken: string;
  lastSeenAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MobileVoipDeviceSchema = new Schema<IMobileVoipDevice>(
  {
    userEmail: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
      trim: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
    },
    platform: {
      type: String,
      required: true,
      enum: ["ios", "android"],
    },
    voipToken: {
      type: String,
      required: true,
    },
    lastSeenAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

MobileVoipDeviceSchema.index({ userEmail: 1, deviceId: 1 }, { unique: true });

const MobileVoipDevice: Model<IMobileVoipDevice> =
  (mongoose.models.MobileVoipDevice as Model<IMobileVoipDevice>) ||
  mongoose.model<IMobileVoipDevice>("MobileVoipDevice", MobileVoipDeviceSchema);

export default MobileVoipDevice;
