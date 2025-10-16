// models/DripFolderEnrollment.ts
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const DripFolderEnrollmentSchema = new Schema({
  userEmail: { type: String, required: true, index: true },
  folderId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "Folder" },
  campaignId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "DripCampaign" },

  // active watchers will continuously pick up NEW leads in the folder
  active: { type: Boolean, default: true, index: true },

  // how to handle initial enrollment timing
  startMode: { type: String, enum: ["immediate", "nextWindow"], default: "immediate" },

  // dedupe safety: last time we scanned the folder for new leads
  lastScanAt: { type: Date },
}, { timestamps: true });

DripFolderEnrollmentSchema.index(
  { userEmail: 1, folderId: 1, campaignId: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

export type DripFolderEnrollment = InferSchemaType<typeof DripFolderEnrollmentSchema>;
export default (models.DripFolderEnrollment as mongoose.Model<DripFolderEnrollment>)
  || model<DripFolderEnrollment>("DripFolderEnrollment", DripFolderEnrollmentSchema);
