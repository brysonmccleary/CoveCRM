
import mongoose, { Schema, models } from "mongoose";

const FunnelSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, index: true },
    userEmail: { type: String, index: true },

    campaignId: { type: Schema.Types.ObjectId, index: true },

    leadType: { type: String, index: true },

    slug: { type: String, unique: true, index: true },

    headline: String,
    subheadline: String,
    quizType: String, // quote_quiz, eligibility_quiz, lead_form

    agentName: String,
    agentPhone: String,
    agentEmail: String,
    brandName: String,

    disclaimerText: String,

    folderId: { type: Schema.Types.ObjectId },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default models.Funnel || mongoose.model("Funnel", FunnelSchema);
