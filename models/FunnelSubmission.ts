
import mongoose, { Schema, models } from "mongoose";

const FunnelSubmissionSchema = new Schema(
  {
    funnelId: { type: Schema.Types.ObjectId, index: true },
    campaignId: { type: Schema.Types.ObjectId, index: true },
    userId: { type: Schema.Types.ObjectId, index: true },
    userEmail: { type: String, index: true },

    slug: { type: String, index: true },
    leadType: { type: String, index: true },

    firstName: String,
    lastName: String,
    phone: String,
    email: String,
    state: String,

    rawPayload: { type: Schema.Types.Mixed },

    createdLeadId: { type: Schema.Types.ObjectId, ref: "Lead", default: null },
    wasDuplicate: { type: Boolean, default: false },

    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

export default models.FunnelSubmission || mongoose.model("FunnelSubmission", FunnelSubmissionSchema);
