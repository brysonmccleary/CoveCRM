// /models/Folder.ts
import mongoose, { Schema, models, model } from "mongoose";
import { isSystemFolderName, isBlockedSystemName, canonicalizeName } from "@/lib/systemFolders";

const FolderSchema = new Schema(
  {
    // keep flexible, but make sure "name" is validated
    name: {
      type: String,
      trim: true,
      required: true,
      validate: {
        validator: (v: string) => {
          const n = String(v || "").trim();
          return n && !isSystemFolderName(n) && !isBlockedSystemName(n);
        },
        message: "Cannot create or rename to system folders",
      },
    },
    userEmail: { type: String, index: true, required: true, lowercase: true, trim: true },
  },
  { strict: false, timestamps: true }
);

function pullNameFromUpdate(update: any): string | undefined {
  if (!update) return undefined;
  const s = update.$set?.name ?? update.$setOnInsert?.name ?? update.name;
  const n = String(s ?? "").trim();
  return n || undefined;
}

function blocked(n?: string | null) {
  const name = String(n ?? "").trim();
  return !!name && (isSystemFolderName(name) || isBlockedSystemName(name));
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

const Folder = (models.Folder as mongoose.Model<any>) || model("Folder", FolderSchema);
export default Folder;
