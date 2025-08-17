import mongoose, { Schema, Document } from "mongoose";

export interface INumber extends Document {
  phoneNumber: string;
  friendlyName?: string;
  sid: string;
  userEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

const NumberSchema = new Schema<INumber>(
  {
    phoneNumber: { type: String, required: true },
    friendlyName: { type: String },
    sid: { type: String, required: true },
    userEmail: { type: String, required: true },
  },
  { timestamps: true }
);

const Number = mongoose.models.Number || mongoose.model<INumber>("Number", NumberSchema);
export default Number;
