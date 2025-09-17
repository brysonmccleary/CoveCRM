// /models/Folder.ts
import mongoose, { Schema, model, models } from "mongoose";
import { isSystemFolderName, isBlockedSystemName } from "@/lib/systemFolders";

type FolderDoc = mongoose.Document & {
  name: string;
  userEmail: string;
  assignedDrips: string[];                 // <-- used by /api/assign-drip-to-folder
  leadIds: mongoose.Types.ObjectId[];      // <-- used by imports to $addToSet
};

const FolderSchema = new Schema<FolderDoc>(
  {
    // keep flexible, but make sure "name" is validated
    name: {
      type: String,
      trim: true,
      required: true,
      validate: {
        validator: (v: unknown): boolean => {
          const n = String(v ?? "").trim();
          return n.length > 0 && !isSystemFolderName(n) && !isBlockedSystemName(n);
        },
        message: "Cannot create or rename to system folders",
      },
    },
    userEmail: { type: String, index: true, required: true, lowercase: true, trim: true },

    // optional fields we use elsewhere
    assignedDrips: { type: [String], default: [] },
    leadIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { strict: false, timestamps: true }
);

function pullNameFromUpdate(update: any): string | undefined {
  if (!update) return undefined;
  const s = update.$set?.name ?? update.$setOnInsert?.name ?? update.name;
  const n = String(s ?? "").trim();
  return n || undefined;
}

function blocked(n?: string | null): boolean {
  const name = String(n ?? "").trim();
  return name.length > 0 && (isSystemFolderName(name) || isBlockedSystemName(name));
}

// Block normal saves
FolderSchema.pre("save", function (next) {
  const n = (this as any).get("name");
  if (blocked(n)) return next(new Error("Cannot create or rename to system folders"));
  next();
});

// Block findOneAndUpdate / upserts
FolderSchema.pre("findOneAndUpdate", function (next) {
  const n = pullNameFromUpdate(this.getUpdate());
  if (blocked(n)) return next(new Error("Cannot create or rename to system folders"));
  next();
});

const Folder =
  (models.Folder as mongoose.Model<FolderDoc>) || model<FolderDoc>("Folder", FolderSchema);

export default Folder;
