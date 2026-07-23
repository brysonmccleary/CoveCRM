import mongoose, { Schema, models } from "mongoose";

// CoveCRM hosts the funnel, disclosures, and claim-control layer. Platform
// approvals are therefore reusable across tenants; tenant records remain
// supported as an optional narrower override.
export const COVECRM_PLATFORM_CLAIM_SCOPE = "__covecrm_platform__";

const MetaClaimApprovalSchema = new Schema(
  {
    userEmail: { type: String, required: true, lowercase: true, trim: true },
    claimText: { type: String, required: true, trim: true },
    claimVersion: { type: String, required: true, trim: true },
    eligibleProducts: { type: [String], required: true, default: [] },
    states: { type: [String], required: true, default: [] },
    carrierBasis: { type: String, required: true, trim: true },
    approvalEvidence: { type: String, required: true, trim: true },
    approvedBy: { type: String, required: true, trim: true },
    approvedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MetaClaimApprovalSchema.index(
  { userEmail: 1, claimText: 1, claimVersion: 1 },
  { unique: true, name: "meta_claim_approval_tenant_claim" }
);
MetaClaimApprovalSchema.index({ userEmail: 1, expiresAt: 1, revokedAt: 1 });

export default models.MetaClaimApproval || mongoose.model("MetaClaimApproval", MetaClaimApprovalSchema);
