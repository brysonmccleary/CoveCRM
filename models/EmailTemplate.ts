// models/EmailTemplate.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const EmailTemplateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    name: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String, default: "" },
  },
  { timestamps: true }
);

export type EmailTemplate = InferSchemaType<typeof EmailTemplateSchema>;
export default (models.EmailTemplate as mongoose.Model<EmailTemplate>) ||
  model<EmailTemplate>("EmailTemplate", EmailTemplateSchema);
