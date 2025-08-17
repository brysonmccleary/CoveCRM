import mongoose from "mongoose";

const CodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // e.g. cove50
  discountAmount: { type: Number, default: 50 }, // $50 off by default
  originalPrice: { type: Number, default: 200 },
  finalPrice: { type: Number, default: 150 },
  ownerEmail: { type: String, default: null }, // if affiliate, else null
  isAffiliateCode: { type: Boolean, default: false },
  affiliatePayout: { type: Number, default: 22.5 }, // 15% of $150
  usageCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.CodeRegistry ||
  mongoose.model("CodeRegistry", CodeSchema);
