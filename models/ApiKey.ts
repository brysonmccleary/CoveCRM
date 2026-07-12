import mongoose, { Schema, model, models } from "mongoose";

export interface IApiKey extends mongoose.Document {
  userEmail: string;
  name: string;
  folderName: string;
  keyPrefix: string;
  keyHash: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

const ApiKeySchema = new Schema<IApiKey>({
  userEmail: { type: String, required: true, lowercase: true, index: true },
  name: { type: String, required: true, trim: true },
  folderName: { type: String, default: "", trim: true },
  keyPrefix: { type: String, required: true },
  keyHash: { type: String, required: true },
  lastUsedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
});

ApiKeySchema.index({ keyHash: 1 }, { name: "api_key_hash_unique", unique: true });
ApiKeySchema.index({ userEmail: 1, createdAt: -1 }, { name: "api_key_user_created" });

const ApiKey =
  (models.ApiKey as mongoose.Model<IApiKey>) || model<IApiKey>("ApiKey", ApiKeySchema);

export default ApiKey;
