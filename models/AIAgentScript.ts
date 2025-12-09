// models/AIAgentScript.ts
import mongoose, { Schema } from "mongoose";

const AIAgentScriptSchema = new Schema(
  {
    key: { type: String, required: true, unique: true }, // e.g. "mortgage_protection"
    name: { type: String, required: true },
    description: { type: String },

    prompt: { type: String, required: true }, // full system / playbook text

    leadType: { type: String }, // e.g. "Mortgage Protection", "Final Expense"
    isDefault: { type: Boolean, default: false },

    // optional: scoped scripts per user if you ever want that
    userEmail: { type: String, index: true },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.AIAgentScript ||
  mongoose.model("AIAgentScript", AIAgentScriptSchema);
