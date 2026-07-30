import mongoose, { InferSchemaType, Schema, model, models } from "mongoose";
import { DEFAULT_DAILY_DM_LIMIT, MAX_DAILY_DM_LIMIT, MIN_DAILY_DM_LIMIT } from "@/lib/recruiting/dm-settings";

const RecruitingCloudAccountSchema = new Schema(
  {
    ownerEmail: { type: String, required: true, lowercase: true, index: true, immutable: true },
    platform: { type: String, enum: ["linkedin", "instagram"], required: true, immutable: true },
    provider: { type: String, enum: ["browserbase"], default: "browserbase", immutable: true },
    providerContextId: { type: String, required: true, select: false, immutable: true },
    loginSessionId: { type: String, default: null, select: false },
    status: {
      type: String,
      enum: ["connecting", "active", "reauth_required", "paused", "canceled"],
      default: "connecting",
      index: true,
    },
    consentVersion: { type: String, required: true, immutable: true },
    consentAcceptedAt: { type: Date, required: true, immutable: true },
    region: { type: String, enum: ["us-west-2", "us-east-1"], default: "us-west-2", immutable: true },
    timeZone: { type: String, default: "America/Phoenix", trim: true },
    // Stable residential-proxy geolocation for this account; set at connect and
    // reused for every session so the account never appears to change location.
    proxyGeolocation: { type: Schema.Types.Mixed, default: null },
    dailyDmLimit: { type: Number, min: MIN_DAILY_DM_LIMIT, max: MAX_DAILY_DM_LIMIT, default: DEFAULT_DAILY_DM_LIMIT },
    profileUrl: { type: String, default: "", trim: true },
    lastAuthenticatedAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    // Consecutive "appears signed out" readings. A single blip backs off and
    // retries; only a confirmed repeat forces the customer to reconnect, so a
    // transient page hiccup never drops a healthy persistent session.
    signedOutStrikes: { type: Number, default: 0 },
    lastActionAt: { type: Date, default: null },
    lastRecipientLock: { type: String, default: null },
    lastAlertSentAt: { type: Date, default: null },
    lastGrowthSnapshotAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    workerLeaseExpiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

RecruitingCloudAccountSchema.index(
  { ownerEmail: 1, platform: 1 },
  { unique: true, partialFilterExpression: { canceledAt: null } },
);
RecruitingCloudAccountSchema.index({ status: 1, workerLeaseExpiresAt: 1, lastActionAt: 1 });

export type RecruitingCloudAccount = InferSchemaType<typeof RecruitingCloudAccountSchema>;
export default (models.RecruitingCloudAccount as mongoose.Model<RecruitingCloudAccount>) ||
  model<RecruitingCloudAccount>("RecruitingCloudAccount", RecruitingCloudAccountSchema);
