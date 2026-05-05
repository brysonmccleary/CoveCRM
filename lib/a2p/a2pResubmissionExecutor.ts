import mongooseConnect from "@/lib/mongooseConnect";
import AdminAiActionProposal from "@/models/AdminAiActionProposal";
import AdminAiAuditLog from "@/models/AdminAiAuditLog";

export async function executeA2PResubmission({
  proposalId,
  approvedBy,
}: {
  proposalId: string;
  approvedBy?: string;
}) {
  await mongooseConnect();
  const proposal = await AdminAiActionProposal.findById(proposalId);
  if (!proposal) return { ok: false, status: "proposal_not_found" };
  if (proposal.actionType !== "a2p_resubmission") {
    return { ok: false, status: "unsupported_action_type" };
  }

  await AdminAiAuditLog.create({
    userId: proposal.targetUserId,
    userEmail: proposal.targetUserEmail,
    targetUserId: proposal.targetUserId,
    targetUserEmail: proposal.targetUserEmail,
    adminEmail: approvedBy || "",
    source: "a2p_failure_detector",
    taskType: "a2p_resubmission",
    eventType: "a2p_resubmission_attempted",
    status: "blocked",
    inputSummary: `Proposal ${proposalId} approved for A2P resubmission.`,
    metadata: { proposalId, autoResubmitEnabled: process.env.A2P_AUTO_RESUBMIT_ENABLED === "true" },
  });

  if (String(process.env.A2P_AUTO_RESUBMIT_ENABLED || "").toLowerCase() !== "true") {
    return { ok: true, status: "approved_pending_manual_resubmission" };
  }

  // TODO: Connect this to the real Twilio A2P submit path once approved.
  // Expected integration point: reuse the campaign submission logic behind
  // /pages/api/a2p/submit-campaign.ts with proposal.proposedPayload applied to
  // the tenant's A2PProfile, then persist Twilio response and audit outcome.
  return { ok: false, status: "resubmission_executor_not_connected" };
}

