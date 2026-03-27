// models/TeamMember.ts
import mongoose, { Schema, models, model } from "mongoose";

const TeamMemberSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, index: true }, // team owner
    memberEmail: { type: String, required: true },
    memberName: { type: String, default: "" },
    role: { type: String, enum: ["member", "manager"], default: "member" },
    status: { type: String, enum: ["active", "removed"], default: "active" },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

TeamMemberSchema.index({ ownerEmail: 1, memberEmail: 1 }, { unique: true });

export default models.TeamMember || model("TeamMember", TeamMemberSchema);
