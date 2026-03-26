// models/EmailSender.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const EmailSenderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    fromName: { type: String, required: true },
    fromEmail: { type: String, required: true },
    replyTo: { type: String, default: "" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

EmailSenderSchema.index({ userId: 1, isDefault: 1 });

export type EmailSender = InferSchemaType<typeof EmailSenderSchema>;
export default (models.EmailSender as mongoose.Model<EmailSender>) ||
  model<EmailSender>("EmailSender", EmailSenderSchema);
