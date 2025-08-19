import mongoose, { Schema, models, model } from "mongoose";

const LeadSchema = new Schema({}, { strict: false, timestamps: true });
const Lead = (models.Lead as mongoose.Model<any>) || model("Lead", LeadSchema);
export type ILead = any;
export default Lead;
