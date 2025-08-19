// /models/PromoUsage.ts
import mongoose from "mongoose";

const PromoUsageSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  users: [{ type: String }], // user emails who used it
  createdAt: { type: Date, default: Date.now },
  lastUsed: { type: Date },
});

export default mongoose.models.PromoUsage ||
  mongoose.model("PromoUsage", PromoUsageSchema);
