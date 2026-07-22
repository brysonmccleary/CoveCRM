import mongoose, { Document, Schema, models } from "mongoose";

export interface IBillingMeterHealth extends Document {
  accountSid: string;
  userEmail: string;
  status: "healthy" | "pending" | "unhealthy";
  cutoverAt: Date;
  discoveryCursorAt: Date;
  lastAttemptAt?: Date | null;
  lastSucceededAt?: Date | null;
  lastWebhookAt?: Date | null;
  lastError?: string | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

const BillingMeterHealthSchema = new Schema<IBillingMeterHealth>(
  {
    accountSid: { type: String, required: true, unique: true, index: true },
    userEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    status: {
      type: String,
      required: true,
      enum: ["healthy", "pending", "unhealthy"],
      default: "pending",
      index: true,
    },
    cutoverAt: { type: Date, required: true },
    discoveryCursorAt: { type: Date, required: true },
    lastAttemptAt: { type: Date, default: null },
    lastSucceededAt: { type: Date, default: null, index: true },
    lastWebhookAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    consecutiveFailures: { type: Number, default: 0 },
  },
  { timestamps: true },
);

BillingMeterHealthSchema.index(
  { userEmail: 1, accountSid: 1 },
  { unique: true, name: "billing_meter_tenant_account" },
);

export default models.BillingMeterHealth ||
  mongoose.model<IBillingMeterHealth>("BillingMeterHealth", BillingMeterHealthSchema);
