import mongoose, { Schema, models, model } from "mongoose";

/**
 * Keep schema flexible with `strict: false`, but explicitly define the
 * fields we care about so we can index/sort without surprises.
 */
const FolderSchema = new Schema(
  {
    userEmail: { type: String, index: true },
    name: { type: String, index: true },

    // optional metadata commonly present in your codebase
    source: { type: String }, // e.g., "google-sheets", "csv", etc.
    leadIds: [{ type: Schema.Types.ObjectId, ref: "Lead" }],

    /**
     * Used to float most-recently-active folders to the top.
     * We manually bump this (see bumpFolderActivity) on imports/edits.
     */
    lastActivityAt: { type: Date, default: Date.now, index: true },
  },
  {
    strict: false,      // allow any other fields you already store
    timestamps: true,   // adds createdAt / updatedAt
  }
);

// Helpful compound index for fast lookups/upserts by name per user
FolderSchema.index({ userEmail: 1, name: 1 }, { unique: false });

const Folder =
  (models.Folder as mongoose.Model<any>) || model("Folder", FolderSchema);

export default Folder;
