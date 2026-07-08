import mongoose, { Schema, models, model } from "mongoose";

export interface ILeadCustomField extends mongoose.Document {
  userEmail: string;
  fieldName: string;
  firstSeenAt: Date;
  source: "csv_import";
}

const LeadCustomFieldSchema = new Schema<ILeadCustomField>(
  {
    userEmail: { type: String, required: true, lowercase: true, index: true },
    fieldName: { type: String, required: true, trim: true },
    firstSeenAt: { type: Date, default: Date.now },
    source: { type: String, enum: ["csv_import"], default: "csv_import" },
  },
  { timestamps: true },
);

LeadCustomFieldSchema.index(
  { userEmail: 1, fieldName: 1 },
  { name: "lead_custom_field_user_name_unique", unique: true },
);

const LeadCustomField =
  (models.LeadCustomField as mongoose.Model<ILeadCustomField>) ||
  model<ILeadCustomField>("LeadCustomField", LeadCustomFieldSchema);

export default LeadCustomField;
