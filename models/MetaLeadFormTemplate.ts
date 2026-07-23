import mongoose, { Schema, models } from "mongoose";

const MetaLeadFormTemplateSchema = new Schema(
  {
    userEmail: { type: String, required: true, lowercase: true, trim: true },
    pageId: { type: String, required: true, trim: true },
    fingerprint: { type: String, required: true, trim: true },
    formId: { type: String, default: "", trim: true },
    formName: { type: String, default: "", trim: true },
    status: { type: String, enum: ["creating", "ready", "failed", "archived"], default: "creating" },
    claimToken: { type: String, default: "" },
    claimedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    specification: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

MetaLeadFormTemplateSchema.index(
  { userEmail: 1, pageId: 1, fingerprint: 1 },
  { unique: true, name: "meta_lead_form_template_unique" }
);
MetaLeadFormTemplateSchema.index({ pageId: 1, formId: 1 }, { sparse: true });

export default models.MetaLeadFormTemplate ||
  mongoose.model("MetaLeadFormTemplate", MetaLeadFormTemplateSchema);
