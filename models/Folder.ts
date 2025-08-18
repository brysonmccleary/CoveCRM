import mongoose, { Schema, Document } from "mongoose";

export interface IFolder extends Document {
  name: string;
  userEmail: string;
  assignedDrips?: string[];
  leadIds?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const FolderSchema = new Schema<IFolder>(
  {
    name: { type: String, required: true },
    userEmail: { type: String, required: true },
    assignedDrips: { type: [String], default: [] },
    leadIds: { type: [String], default: [] },
  },
  { timestamps: true },
);

const Folder =
  mongoose.models.Folder || mongoose.model<IFolder>("Folder", FolderSchema);
export default Folder;
