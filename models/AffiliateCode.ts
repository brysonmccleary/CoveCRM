// models/AffiliateCode.ts
import mongoose, { Schema, Document, models } from "mongoose";

export interface IAffiliateCode extends Document {
  referralCode: string;
  email: string;
  active: boolean;
  uses: number;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AffiliateCodeSchema = new Schema<IAffiliateCode>(
  {
    referralCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true, // normalize
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true, // normalize
      trim: true,
      index: true,
    },
    active: { type: Boolean, default: true },
    uses: { type: Number, default: 0 },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);

// Ensure unique index exists even if collection pre-exists
AffiliateCodeSchema.index({ referralCode: 1 }, { unique: true });

export default models.AffiliateCode ||
  mongoose.model<IAffiliateCode>("AffiliateCode", AffiliateCodeSchema);
