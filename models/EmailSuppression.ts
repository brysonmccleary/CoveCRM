// models/EmailSuppression.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const EmailSuppressionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    // the recipient email address being suppressed
    email: { type: String, required: true, index: true },
    reason: {
      type: String,
      enum: ["unsubscribed", "bounced", "complaint", "manual"],
      default: "manual",
    },
    suppressedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

// One suppression record per sender+recipient pair
EmailSuppressionSchema.index({ userEmail: 1, email: 1 }, { unique: true });

export type EmailSuppression = InferSchemaType<typeof EmailSuppressionSchema>;
export default (models.EmailSuppression as mongoose.Model<EmailSuppression>) ||
  model<EmailSuppression>("EmailSuppression", EmailSuppressionSchema);
