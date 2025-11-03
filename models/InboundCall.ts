import mongoose, { Schema, Document, models } from "mongoose";

export interface IInboundCall extends Document {
  callSid: string;
  from: string;
  to: string;
  ownerEmail?: string | null;
  leadId?: mongoose.Types.ObjectId | null;
  state: "ringing" | "answered" | "declined" | "completed" | "expired";
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date; // used for auto-cleanup of stale banners
}

const InboundCallSchema = new Schema<IInboundCall>(
  {
    callSid: { type: String, required: true, unique: true, index: true },
    from: { type: String, required: true, index: true },
    to: { type: String, required: true, index: true },
    ownerEmail: { type: String, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
    state: {
      type: String,
      enum: ["ringing", "answered", "declined", "completed", "expired"],
      default: "ringing",
      index: true,
    },
    expiresAt: { type: Date, index: true },
  },
  { timestamps: true }
);

// TTL-like cleanup (optional): If you want Mongo to auto-purge stale rows,
// you can create an index externally: db.inboundcalls.createIndex({expiresAt:1},{expireAfterSeconds:0})
// We do NOT enforce it here to avoid accidental destructive changes.

const InboundCall =
  (models.InboundCall as mongoose.Model<IInboundCall>) ||
  mongoose.model<IInboundCall>("InboundCall", InboundCallSchema);

export default InboundCall;
