// /models/Folder.ts
import mongoose, { Schema, models, model } from "mongoose";

/**
 * We keep strict:false to avoid breaking any existing dynamic fields,
 * but we add explicit indices so we can reliably map Sheet -> Folder.
 */
const FolderSchema = new Schema(
  {
    userEmail: { type: String, index: true },
    name: { type: String, index: true },
    source: { type: String },            // e.g. "google-sheets"
    sheetId: { type: String, index: true }, // Google Spreadsheet ID (optional)
    leadIds: [{ type: Schema.Types.ObjectId, ref: "Lead" }],
  },
  { strict: false, timestamps: true }
);

// Unique (userEmail, sheetId) if sheetId exists
try {
  FolderSchema.index(
    { userEmail: 1, sheetId: 1 },
    { unique: true, partialFilterExpression: { sheetId: { $exists: true, $ne: "" } } }
  );
} catch (e) {
  // index may already exist in some environments; ignore
}

const Folder =
  (models.Folder as mongoose.Model<any>) || model("Folder", FolderSchema);

export default Folder;
