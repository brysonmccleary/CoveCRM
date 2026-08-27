
import mongoose, { Schema, models } from "mongoose";

const FunnelSubmissionSchema = new Schema(
  {
    funnelId: { type: Schema.Types.ObjectId, index: true, immutable: true },
    campaignId: { type: Schema.Types.ObjectId, index: true, immutable: true },
    userId: { type: Schema.Types.ObjectId, index: true, immutable: true },
    userEmail: { type: String, index: true, immutable: true },

    slug: { type: String, index: true, immutable: true },
    leadType: { type: String, index: true, immutable: true },
    submissionEventId: { type: String, index: true, immutable: true },
    preferredLanguage: { type: String, enum: ["", "English", "Spanish"], default: "", immutable: true },

    firstName: { type: String, immutable: true },
    lastName: { type: String, immutable: true },
    phone: { type: String, immutable: true },
    email: { type: String, immutable: true },
    state: { type: String, immutable: true },

    rawPayload: { type: Schema.Types.Mixed, immutable: true },

    createdLeadId: { type: Schema.Types.ObjectId, ref: "Lead", default: null },
    wasDuplicate: { type: Boolean, default: false, immutable: true },
    processingStatus: {
      type: String,
      enum: ["received", "processed", "repeat_opt_in", "failed"],
      default: "received",
      index: true,
    },

    metaCampaignId: { type: String, default: "", immutable: true },
    metaAdsetId: { type: String, default: "", immutable: true },
    metaAdId: { type: String, default: "", immutable: true },
    metaCreativeId: { type: String, default: "", immutable: true },
    variantId: { type: String, default: "", immutable: true },
    creativeFamily: { type: String, default: "", immutable: true },
    fbclid: { type: String, default: "", immutable: true },
    fbc: { type: String, default: "", immutable: true },
    fbp: { type: String, default: "", immutable: true },
    utm: { type: Schema.Types.Mixed, default: {}, immutable: true },

    ipAddress: { type: String, default: "", immutable: true },
    userAgent: { type: String, default: "", immutable: true },
  },
  { timestamps: true }
);

FunnelSubmissionSchema.index(
  { userEmail: 1, submissionEventId: 1 },
  {
    unique: true,
    partialFilterExpression: { submissionEventId: { $type: "string", $gt: "" } },
    name: "funnel_submission_event_unique",
  }
);

export default models.FunnelSubmission || mongoose.model("FunnelSubmission", FunnelSubmissionSchema);
