// models/ObjectionEntry.ts
import mongoose, { Schema, models, model } from "mongoose";

const ObjectionEntrySchema = new Schema(
  {
    userEmail: { type: String, default: "" }, // empty = global/shared
    objection: { type: String, required: true },
    response: { type: String, required: true },
    category: {
      type: String,
      enum: ["price", "trust", "timing", "need", "spouse", "competitor", "other"],
      default: "other",
    },
    isGlobal: { type: Boolean, default: false },
    useCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ObjectionEntrySchema.index({ userEmail: 1, category: 1 });
ObjectionEntrySchema.index({ isGlobal: 1 });

export default models.ObjectionEntry || model("ObjectionEntry", ObjectionEntrySchema);
