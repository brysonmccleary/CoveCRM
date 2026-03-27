// models/VoicemailDrop.ts
import mongoose, { Schema, models, model } from "mongoose";

const VoicemailDropSchema = new Schema(
  {
    userEmail: { type: String, required: true, index: true },
    name: { type: String, required: true }, // e.g. "Final Expense Intro"
    leadType: {
      type: String,
      enum: ["Final Expense", "Veteran", "Mortgage Protection", "IUL", "General"],
      default: "General",
    },
    scriptText: { type: String, required: true },
    ttsVoice: { type: String, default: "Polly.Matthew" }, // Twilio TTS voice
    audioUrl: { type: String, default: "" }, // optional pre-recorded MP3
    isDefault: { type: Boolean, default: false },
    dropCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default models.VoicemailDrop || model("VoicemailDrop", VoicemailDropSchema);
