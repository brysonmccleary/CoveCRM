import mongoose, { Schema, models, model } from "mongoose";

const FolderSchema = new Schema({}, { strict: false, timestamps: true });
const Folder = (models.Folder as mongoose.Model<any>) || model("Folder", FolderSchema);
export default Folder;
