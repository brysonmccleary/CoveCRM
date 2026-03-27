// models/PlatformEmailRecord.ts
// Tracks every platform-level (CoveCRM own) outreach email sent to DOI leads.
// Separate from EmailMessage (which is agent-to-lead), so userId/leadId are not required.
import mongoose, { Schema, InferSchemaType, models, model } from "mongoose";

const PlatformEmailRecordSchema = new Schema(
  {
    // The DOI lead email address that was contacted
    toEmail: { type: String, required: true, index: true },
    doiLeadId: {
      type: Schema.Types.ObjectId,
      ref: "DOILead",
      index: true,
    },
    senderId: { type: Schema.Types.ObjectId, ref: "PlatformSender", index: true },
    senderEmail: { type: String, required: true },
    subject: { type: String, required: true },
    status: {
      type: String,
      enum: ["queued", "sent", "failed"],
      default: "queued",
      index: true,
    },
    sentAt: { type: Date, index: true },
    error: { type: String, default: "" },
    // Identifies this as a platform (CoveCRM) send, not an agent send
    platformSend: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

PlatformEmailRecordSchema.index({ toEmail: 1, platformSend: 1 });
PlatformEmailRecordSchema.index({ doiLeadId: 1, platformSend: 1 });

export type PlatformEmailRecord = InferSchemaType<typeof PlatformEmailRecordSchema>;
export default (models.PlatformEmailRecord as mongoose.Model<PlatformEmailRecord>) ||
  model<PlatformEmailRecord>("PlatformEmailRecord", PlatformEmailRecordSchema);
