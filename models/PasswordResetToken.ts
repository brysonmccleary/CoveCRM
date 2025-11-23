// /models/PasswordResetToken.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IPasswordResetToken extends Document {
  userEmail: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt?: Date;
}

const PasswordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    userEmail: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true },
    // Remove field-level index to avoid duplicate with TTL index below
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// TTL on expiresAt (Mongo will remove after the time passes)
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Uniqueness per email/hash
PasswordResetTokenSchema.index(
  { userEmail: 1, tokenHash: 1 },
  { unique: true },
);

const PasswordResetToken =
  (mongoose.models.PasswordResetToken as mongoose.Model<IPasswordResetToken>) ||
  mongoose.model<IPasswordResetToken>(
    "PasswordResetToken",
    PasswordResetTokenSchema,
  );

export default PasswordResetToken;
