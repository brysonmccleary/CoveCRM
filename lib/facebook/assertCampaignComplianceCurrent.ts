import MetaLaunchArchive from "@/models/MetaLaunchArchive";
import MetaClaimApproval, { COVECRM_PLATFORM_CLAIM_SCOPE } from "@/models/MetaClaimApproval";

export async function assertCampaignComplianceCurrent(input: { campaign: any; userEmail: string }) {
  const userEmail = String(input.userEmail || "").trim().toLowerCase();
  const campaign = input.campaign;
  const archive = await MetaLaunchArchive.findOne({
    userEmail: { $in: [COVECRM_PLATFORM_CLAIM_SCOPE, userEmail] },
    launchFingerprint: String(campaign?.launchFingerprint || ""),
  }).lean() as any;
  if (!archive) {
    throw new Error("This campaign has no immutable compliance archive. Recreate it through the current insurance launch flow before activation.");
  }
  const archivedClaims = Array.isArray(archive.claims) ? archive.claims : [];
  if (!archivedClaims.length) return;

  const approvals = await MetaClaimApproval.find({
    userEmail,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
    $or: archivedClaims.map((claim: any) => ({
      claimText: String(claim.claimText || ""),
      claimVersion: String(claim.version || ""),
    })),
  }).lean() as any[];
  const licensedStates = Array.isArray(campaign?.licensedStates) ? campaign.licensedStates.map(String) : [];
  const approvedKeys = new Set(approvals
    .filter((approval: any) =>
      Array.isArray(approval.eligibleProducts) && approval.eligibleProducts.includes(String(campaign?.leadType)) &&
      Array.isArray(approval.states) && (
        approval.states.includes("*") || licensedStates.every((state: string) => approval.states.includes(state))
      ) &&
      /^https:\/\//i.test(String(approval.approvalEvidence || ""))
    )
    .map((approval: any) => `${approval.claimText}::${approval.claimVersion}`));
  const missingApproval = archivedClaims.find((claim: any) =>
    !approvedKeys.has(`${String(claim.claimText || "")}::${String(claim.version || "")}`)
  );
  if (missingApproval) {
    throw new Error(`Carrier/compliance approval is missing, expired, revoked, or out of scope for claim: ${missingApproval.claimText}`);
  }
}
