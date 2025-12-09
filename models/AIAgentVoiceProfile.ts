// models/AIAgentVoiceProfile.ts
import mongoose, { Schema } from "mongoose";

const AIAgentVoiceProfileSchema = new Schema(
  {
    key: { type: String, required: true, unique: true }, // e.g. "calm_male"
    name: { type: String, required: true }, // e.g. "Calm Male"
    description: { type: String },

    provider: {
      type: String,
      default: "openai", // could be "openai", "elevenlabs", etc.
    },
    providerVoiceId: { type: String, required: true },

    // optional per-user custom voices
    userEmail: { type: String, index: true },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.AIAgentVoiceProfile ||
  mongoose.model("AIAgentVoiceProfile", AIAgentVoiceProfileSchema);
