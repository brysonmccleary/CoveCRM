import mongoose, { Schema, Document, models } from "mongoose";

export type UsageAccrualBucket = "regular" | "ai_voice";
export type UsageAccrualStatus = "accrued" | "billed" | "skipped";

export interface IUsageAccrualLedger extends Document {
  bucket: UsageAccrualBucket;
  userEmail: string;
  eventKey: string;
  source: string;
  origin?: "dialer" | "regular" | null;
  amountCents: number;
  billedCents: number;
  status: UsageAccrualStatus;
  metadata?: Record<string, unknown>;
  accruedAt: Date;
  billedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UsageAccrualLedgerSchema = new Schema<IUsageAccrualLedger>(
  {
    bucket: { type: String, required: true, enum: ["regular", "ai_voice"], index: true },
    userEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    eventKey: { type: String, required: true, index: true },
    source: { type: String, required: true, index: true },
    origin: { type: String, enum: ["dialer", "regular", null], default: null, index: true },
    amountCents: { type: Number, required: true, default: 0 },
    billedCents: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      required: true,
      enum: ["accrued", "billed", "skipped"],
      default: "accrued",
      index: true,
    },
    metadata: { type: Schema.Types.Mixed },
    accruedAt: { type: Date, default: Date.now, index: true },
    billedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

UsageAccrualLedgerSchema.index(
  { bucket: 1, userEmail: 1, status: 1, accruedAt: 1 },
  { name: "usage_accrual_bucket_user_status_accrued" },
);
UsageAccrualLedgerSchema.index(
  { userEmail: 1, bucket: 1, eventKey: 1 },
  { unique: true, name: "usage_accrual_tenant_bucket_event" },
);

export default models.UsageAccrualLedger ||
  mongoose.model<IUsageAccrualLedger>("UsageAccrualLedger", UsageAccrualLedgerSchema);
