// models/TeamInvite.ts
import mongoose, { Schema, models, model } from "mongoose";

const TeamInviteSchema = new Schema(
  {
    ownerEmail: { type: String, required: true },
    inviteeEmail: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true }, // SHA-256 of raw token
    status: { type: String, enum: ["pending", "accepted", "expired"], default: "pending" },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

TeamInviteSchema.index({ ownerEmail: 1, inviteeEmail: 1 });

export default models.TeamInvite || model("TeamInvite", TeamInviteSchema);
