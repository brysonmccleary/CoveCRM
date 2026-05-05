// models/EmailBounce.ts
// Stores bounce events for DOI outreach emails.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const EmailBounceSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: "DOIAgent", index: true },
    domain: { type: String, default: "", index: true },
    bounceType: {
      type: String,
      enum: ["hard", "soft", ""],
      default: "",
    },
    reason: { type: String, default: "" },
    source: {
      type: String,
      enum: ["domain_pattern", "personal_guess", "website", "manual", ""],
      default: "",
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

EmailBounceSchema.index({ email: 1, bounceType: 1 });

export type EmailBounce = InferSchemaType<typeof EmailBounceSchema>;
export default (models.EmailBounce as mongoose.Model<EmailBounce>) ||
  model<EmailBounce>("EmailBounce", EmailBounceSchema);
