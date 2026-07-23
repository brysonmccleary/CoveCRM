
import mongoose, { Schema, models } from "mongoose";

const FunnelSubmissionSchema = new Schema(
  {
    funnelId: { type: Schema.Types.ObjectId, index: true, immutable: true },
    campaignId: { type: Schema.Types.ObjectId, index: true, immutable: true },
    userId: { type: Schema.Types.ObjectId, index: true, immutable: true },
    userEmail: { type: String, index: true, immutable: true },

    slug: { type: String, index: true, immutable: true },
    leadType: { type: String, index: true, immutable: true },

    firstName: { type: String, immutable: true },
    lastName: { type: String, immutable: true },
    phone: { type: String, immutable: true },
    email: { type: String, immutable: true },
    state: { type: String, immutable: true },

    rawPayload: { type: Schema.Types.Mixed, immutable: true },

    createdLeadId: { type: Schema.Types.ObjectId, ref: "Lead", default: null },
    wasDuplicate: { type: Boolean, default: false, immutable: true },

    ipAddress: { type: String, default: "", immutable: true },
    userAgent: { type: String, default: "", immutable: true },
  },
  { timestamps: true }
);

export default models.FunnelSubmission || mongoose.model("FunnelSubmission", FunnelSubmissionSchema);
