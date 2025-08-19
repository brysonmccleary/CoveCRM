// /models/PhoneNumber.ts
import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPhoneNumber extends Document {
  userId: Types.ObjectId; // Owner (signed-in user)
  phoneNumber: string; // E.164, e.g. +14155551234
  messagingServiceSid?: string; // Twilio Messaging Service SID (per-user or shared)
  profileSid?: string; // A2P profile SID (if you store it)
  a2pApproved?: boolean; // Convenience flag
  datePurchased?: Date; // When we bought it
  twilioSid?: string; // IncomingPhoneNumbers SID (optional, we can fill later)
  friendlyName?: string; // Optional label
  createdAt: Date;
  updatedAt: Date;
}

const PhoneNumberSchema = new Schema<IPhoneNumber>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    phoneNumber: { type: String, required: true, unique: true, index: true },
    messagingServiceSid: { type: String },
    profileSid: { type: String },
    a2pApproved: { type: Boolean, default: false },
    datePurchased: { type: Date, default: Date.now },
    twilioSid: { type: String },
    friendlyName: { type: String },
  },
  { timestamps: true },
);

// Dev hot-reload safe export
const PhoneNumber =
  (mongoose.models.PhoneNumber as mongoose.Model<IPhoneNumber>) ||
  mongoose.model<IPhoneNumber>("PhoneNumber", PhoneNumberSchema);

export default PhoneNumber;
