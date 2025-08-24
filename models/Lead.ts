import mongoose, { Schema, models, model } from "mongoose";

const LeadSchema = new Schema({}, { strict: false, timestamps: true });

// Common lookups we do in webhooks/senders
LeadSchema.index({ userEmail: 1, Phone: 1 }, { name: "lead_user_phone_idx" });
LeadSchema.index({ userEmail: 1, phone: 1 }, { name: "lead_user_phone_lower_idx" });
LeadSchema.index({ ownerEmail: 1, Phone: 1 }, { name: "lead_owner_phone_idx" });

// General user scoping + recents
LeadSchema.index({ userEmail: 1, updatedAt: -1 }, { name: "lead_user_updated_desc" });

// For state-based quiet-hours / segmentation
LeadSchema.index({ State: 1 }, { name: "lead_state_idx" });

// For AI engagement / drips filtering
LeadSchema.index({ userEmail: 1, isAIEngaged: 1, updatedAt: -1 }, { name: "lead_ai_engaged_idx" });

const Lead = (models.Lead as mongoose.Model<any>) || model("Lead", LeadSchema);
export type ILead = any;
export default Lead;
