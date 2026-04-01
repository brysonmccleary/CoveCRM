// models/FBLeadEntry.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const FBLeadEntrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "FBLeadCampaign", required: true, index: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    leadType: {
      type: String,
      enum: ["final_expense", "iul", "mortgage_protection", "veteran", "trucker"],
      required: true,
    },
    source: {
      type: String,
      enum: ["manual_import", "facebook_webhook", "facebook_meta_native", "csv", "google_sheet_sync"],
      default: "csv",
    },
    facebookLeadId: { type: String }, // FB's internal lead ID (Phase 2)
    crmLeadId: { type: Schema.Types.ObjectId, ref: "Lead" }, // set when imported to CRM
    folderId: { type: Schema.Types.ObjectId, ref: "Folder" },
    importedToCrm: { type: Boolean, default: false, index: true },
    importedAt: { type: Date },
  },
  { timestamps: true }
);

FBLeadEntrySchema.index({ userId: 1, importedToCrm: 1 });
FBLeadEntrySchema.index({ campaignId: 1, importedToCrm: 1 });
FBLeadEntrySchema.index({ userId: 1, campaignId: 1 });

export type FBLeadEntry = InferSchemaType<typeof FBLeadEntrySchema>;
export default (models.FBLeadEntry as mongoose.Model<FBLeadEntry>) ||
  model<FBLeadEntry>("FBLeadEntry", FBLeadEntrySchema);
