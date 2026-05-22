// lib/a2p/a2pDryRunSimulator.ts
//
// READ-ONLY dry-run simulator for A2P recovery proposals.
// Produces a deterministic plan describing what would happen if an admin
// approved a pending AdminAiActionProposal.
//
// GUARANTEES:
//   - Calls no Twilio APIs
//   - Writes no DB records
//   - Sends no SMS or email
//   - Touches no billing
//   - Connects no executor
//   - Does not invoke start.ts or resumeAutomation

import crypto from "crypto";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import AdminAiActionProposal from "@/models/AdminAiActionProposal";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_PROPOSAL_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CAMPAIGN_SUBMIT_CEILING = 3;
const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const RECENT_SUBMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

const BRAND_APPROVED_STATUSES = new Set([
  "APPROVED",
  "TWILIO_APPROVED",
  "ACTIVE",
  "IN_USE",
  "REGISTERED",
  "VERIFIED",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type SimulatorInput = {
  proposalId: string;
  requestedBy?: string;
  maxProposalAgeMs?: number;
};

type FieldComparison = {
  current: string | null;
  proposed: string | null;
};

export type SimulatorOutput = {
  simulationFingerprint: string;
  simulatedAt: Date;
  canProceed: boolean;
  riskLevel: "low" | "medium" | "high" | "blocked";
  requiredAdminApproval: true;
  blockers: string[];
  warnings: string[];
  currentState: {
    profileId: string;
    userEmail: string;
    messagingReady: boolean;
    applicationStatus: string;
    registrationStatus: string;
    brandSid: string | null;
    brandStatus: string | null;
    campaignSid: string | null;
    campaignStatus: string | null;
    trustProductSid: string | null;
    profileSid: string | null;
    failure: {
      stage?: string;
      simpleTitle?: string;
      signature?: string;
    } | null;
    profileUpdatedAt: Date;
    lastSubmittedAt: Date | null;
    campaignSubmitAttempts: number;
  };
  proposedChanges: {
    proposalId: string;
    classification: string;
    confidence: number;
    issueType: string;
    likelyCause: string;
    fieldsToUpdate: Record<string, FieldComparison>;
    wouldTriggerChainRotation: boolean;
    wouldTouchBrand: boolean;
    wouldTouchCampaign: boolean;
    wouldTouchTrustProduct: boolean;
  };
  intendedDbMutations: string[];
  intendedTwilioActions: string[];
  forbiddenActionsConfirmedNotUsed: {
    noTwilioCallsMade: true;
    noSmsSent: true;
    noEmailSent: true;
    noDbWritten: true;
    noStartTsInvoked: true;
    noExecutorConnected: true;
    noBillingTouched: true;
  };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeUpper(v: any): string {
  return String(v || "").trim().toUpperCase();
}

function normalizeStr(v: any): string {
  return String(v || "").trim();
}

function joinSamples(v: any): string {
  if (Array.isArray(v)) {
    return v
      .map((s: any) => String(s || "").trim())
      .filter(Boolean)
      .join("\n\n");
  }
  return normalizeStr(v);
}

function normalizeEinDigits(v: any): string {
  return String(v || "").replace(/[^0-9]/g, "");
}

function fieldDiff(
  current: string | null | undefined,
  proposed: string | null | undefined
): FieldComparison | null {
  const c = normalizeStr(current);
  const p = normalizeStr(proposed);
  if (!p) return null;
  if (c.toLowerCase() === p.toLowerCase()) return null;
  return { current: c || null, proposed: p };
}

function computeFingerprint(
  proposalId: string,
  profileUpdatedAt: Date,
  proposalCreatedAt: Date
): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        proposalId,
        profileUpdatedAt.toISOString(),
        proposalCreatedAt.toISOString(),
      ].join("|")
    )
    .digest("hex")
    .slice(0, 32);
}

function truncate(s: string, max = 80): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function simulateA2PResubmission(
  input: SimulatorInput
): Promise<SimulatorOutput> {
  await mongooseConnect();

  const simulatedAt = new Date();
  const maxAgeMs = input.maxProposalAgeMs ?? DEFAULT_MAX_PROPOSAL_AGE_MS;

  const FORBIDDEN: SimulatorOutput["forbiddenActionsConfirmedNotUsed"] = {
    noTwilioCallsMade: true,
    noSmsSent: true,
    noEmailSent: true,
    noDbWritten: true,
    noStartTsInvoked: true,
    noExecutorConnected: true,
    noBillingTouched: true,
  };

  // ── Early blocked helper ────────────────────────────────────────────────────
  // Used before we have a full profile+proposal to build the complete output.

  function earlyBlocked(blockers: string[]): SimulatorOutput {
    const fp = crypto
      .createHash("sha256")
      .update(input.proposalId + "|blocked|" + simulatedAt.toISOString())
      .digest("hex")
      .slice(0, 32);
    return {
      simulationFingerprint: fp,
      simulatedAt,
      canProceed: false,
      riskLevel: "blocked",
      requiredAdminApproval: true,
      blockers,
      warnings: [],
      currentState: {
        profileId: "",
        userEmail: "",
        messagingReady: false,
        applicationStatus: "",
        registrationStatus: "",
        brandSid: null,
        brandStatus: null,
        campaignSid: null,
        campaignStatus: null,
        trustProductSid: null,
        profileSid: null,
        failure: null,
        profileUpdatedAt: simulatedAt,
        lastSubmittedAt: null,
        campaignSubmitAttempts: 0,
      },
      proposedChanges: {
        proposalId: input.proposalId,
        classification: "",
        confidence: 0,
        issueType: "",
        likelyCause: "",
        fieldsToUpdate: {},
        wouldTriggerChainRotation: false,
        wouldTouchBrand: false,
        wouldTouchCampaign: false,
        wouldTouchTrustProduct: false,
      },
      intendedDbMutations: [],
      intendedTwilioActions: [],
      forbiddenActionsConfirmedNotUsed: FORBIDDEN,
    };
  }

  // ── Load proposal (read-only) ───────────────────────────────────────────────

  if (!input.proposalId || !input.proposalId.trim()) {
    return earlyBlocked(["Proposal ID is required."]);
  }

  let proposal: any;
  try {
    proposal = await (AdminAiActionProposal as any)
      .findById(input.proposalId.trim())
      .lean();
  } catch {
    return earlyBlocked(["Failed to load proposal from database."]);
  }

  if (!proposal) {
    return earlyBlocked([
      "Proposal not found. Cannot simulate without a valid proposal.",
    ]);
  }

  if (proposal.actionType !== "a2p_resubmission") {
    return earlyBlocked([
      `Proposal action type is not a2p_resubmission (found: ${proposal.actionType || "unknown"}). Only a2p_resubmission proposals can be simulated here.`,
    ]);
  }

  if (proposal.status !== "pending") {
    return earlyBlocked([
      `Proposal is not in pending state (current: ${proposal.status}). Only pending proposals can be simulated.`,
    ]);
  }

  const proposalCreatedAt = new Date(proposal.createdAt);
  const proposalAgeMs = simulatedAt.getTime() - proposalCreatedAt.getTime();
  if (proposalAgeMs > maxAgeMs) {
    const days = Math.floor(proposalAgeMs / (24 * 60 * 60 * 1000));
    const limitDays = Math.floor(maxAgeMs / (24 * 60 * 60 * 1000));
    return earlyBlocked([
      `Proposal is stale (created ${days} day${days === 1 ? "" : "s"} ago; limit is ${limitDays} days). Re-run failure detection to create a fresh proposal from the current profile state.`,
    ]);
  }

  // ── Load A2PProfile (read-only) ────────────────────────────────────────────

  const targetEmail = normalizeStr(proposal.targetUserEmail).toLowerCase();
  const targetUserId = normalizeStr(proposal.targetUserId);

  let profile: any;
  try {
    profile = targetEmail
      ? await (A2PProfile as any).findOne({ userEmail: targetEmail }).lean()
      : targetUserId
      ? await (A2PProfile as any).findOne({ userId: targetUserId }).lean()
      : null;
  } catch {
    return earlyBlocked(["Failed to load A2PProfile from database."]);
  }

  if (!profile) {
    return earlyBlocked([
      "A2PProfile not found for this proposal's target user. The profile may have been deleted.",
    ]);
  }

  // ── State we'll accumulate ─────────────────────────────────────────────────

  const blockers: string[] = [];
  const warnings: string[] = [];

  const profileId = String(profile._id || "");
  const profileUpdatedAt = profile.updatedAt
    ? new Date(profile.updatedAt)
    : new Date(profile.createdAt || simulatedAt);

  const fingerprint = computeFingerprint(
    input.proposalId,
    profileUpdatedAt,
    proposalCreatedAt
  );

  // ── Block: profile changed after proposal was created ─────────────────────

  if (profileUpdatedAt.getTime() > proposalCreatedAt.getTime()) {
    const deltaSec = Math.round(
      (profileUpdatedAt.getTime() - proposalCreatedAt.getTime()) / 1000
    );
    blockers.push(
      `A2PProfile was updated ${deltaSec}s after this proposal was created. ` +
        "The profile state may have changed. Re-run failure detection to create a fresh proposal."
    );
  }

  // ── Block: already approved / messaging ready ─────────────────────────────

  if (profile.messagingReady === true) {
    blockers.push(
      "A2P profile is already messaging-ready. Resubmission is not needed."
    );
  }

  if (normalizeUpper(profile.applicationStatus) === "APPROVED") {
    blockers.push(
      "Application is already approved. Resubmission is not permitted for approved profiles."
    );
  }

  // ── Extract proposedPayload fields ─────────────────────────────────────────

  const pp = (proposal.proposedPayload || {}) as Record<string, any>;
  const classification = normalizeStr(pp.classification);
  const issueType = normalizeStr(pp.issueType);
  const likelyCause = normalizeStr(pp.likelyCause);
  const confidence = Number(proposal.confidence || 0);

  // ── Block: EIN missing ────────────────────────────────────────────────────

  const profileEin = normalizeEinDigits(profile.ein);
  const proposedEin = normalizeEinDigits(pp.ein || pp.correctedEin);

  if (!profileEin && !proposedEin) {
    blockers.push(
      "EIN is required for A2P registration and is missing from both the current profile and the proposed payload. Cannot proceed."
    );
  }

  // ── Block: EIN change ─────────────────────────────────────────────────────

  if (profileEin && proposedEin && profileEin !== proposedEin) {
    blockers.push(
      "EIN changes require full chain recreation (all Twilio SIDs must be rotated). " +
        "This cannot be executed autonomously — contact Twilio support."
    );
  }

  // ── Block: address change ─────────────────────────────────────────────────

  const addressFields: Array<[string, string]> = [
    ["address", "address"],
    ["addressCity", "addressCity"],
    ["addressState", "addressState"],
    ["addressPostalCode", "addressPostalCode"],
    ["addressCountry", "addressCountry"],
  ];
  const changedAddressKeys = addressFields
    .filter(([ppKey, profKey]) => {
      const proposed = normalizeStr(pp[ppKey]);
      const current = normalizeStr(profile[profKey]);
      return (
        proposed &&
        current &&
        proposed.toLowerCase() !== current.toLowerCase()
      );
    })
    .map(([k]) => k);

  if (changedAddressKeys.length > 0) {
    blockers.push(
      `Address field changes (${changedAddressKeys.join(", ")}) require recreating the Twilio Address SID ` +
        "and SupportingDocument, which touches the full TrustHub bundle. " +
        "This cannot be executed autonomously."
    );
  }

  // ── Block: campaignSubmitAttempts ceiling ─────────────────────────────────

  const campaignSubmitAttempts = Number(profile.campaignSubmitAttempts || 0);
  if (campaignSubmitAttempts >= CAMPAIGN_SUBMIT_CEILING) {
    blockers.push(
      `Campaign submission has exceeded the safe retry ceiling (${campaignSubmitAttempts}/${CAMPAIGN_SUBMIT_CEILING} attempts). ` +
        "Manual Twilio account review is required before retrying."
    );
  }

  // ── Compute field-level diffs ─────────────────────────────────────────────

  const fieldsToUpdate: Record<string, FieldComparison> = {};

  // Website
  const websiteDiff = fieldDiff(
    profile.website,
    pp.website || pp.correctedWebsite
  );
  if (websiteDiff) fieldsToUpdate.website = websiteDiff;

  // Sample messages
  const currentSamples = joinSamples(
    (profile.sampleMessagesArr as string[] | undefined)?.length
      ? profile.sampleMessagesArr
      : profile.sampleMessages
  );
  const proposedSamples = joinSamples(
    pp.correctedSampleMessages || pp.messageSamples || pp.sampleMessages
  );
  const samplesDiff = fieldDiff(currentSamples, proposedSamples);
  if (samplesDiff) fieldsToUpdate.sampleMessages = samplesDiff;

  // Opt-in / message flow
  const optInDiff = fieldDiff(
    profile.optInDetails,
    pp.correctedOptInDescription || pp.messageFlow || pp.optInDetails
  );
  if (optInDiff) fieldsToUpdate.optInDetails = optInDiff;

  // Campaign description (no current equivalent — always proposed)
  if (pp.correctedCampaignDescription) {
    fieldsToUpdate.campaignDescription = {
      current: null,
      proposed: normalizeStr(pp.correctedCampaignDescription),
    };
  }

  // Privacy policy notes → landingPrivacyUrl
  if (pp.correctedPrivacyPolicyNotes) {
    fieldsToUpdate.landingPrivacyUrl = {
      current: normalizeStr(profile.landingPrivacyUrl) || null,
      proposed: normalizeStr(pp.correctedPrivacyPolicyNotes),
    };
  }

  // Terms notes → landingTosUrl
  if (pp.correctedTermsNotes) {
    fieldsToUpdate.landingTosUrl = {
      current: normalizeStr(profile.landingTosUrl) || null,
      proposed: normalizeStr(pp.correctedTermsNotes),
    };
  }

  // Company type (A2P TrustProduct EndUser attribute)
  const proposedCompanyType = normalizeStr(
    pp.company_type || pp.businessType || pp.correctedCompanyType
  );
  if (proposedCompanyType && proposedCompanyType !== "private") {
    // Any non-private value is suspicious; flag it
    warnings.push(
      `Proposed company_type "${proposedCompanyType}" is not the standard "private" used by this system. Verify before applying.`
    );
  }
  if (proposedCompanyType) {
    fieldsToUpdate.company_type = {
      current: "private",
      proposed: proposedCompanyType,
    };
  }

  // ── Determine what Twilio objects would be touched ────────────────────────

  const brandStatus = normalizeUpper(profile.brandStatus);
  const profileStatus = normalizeUpper(profile.profileStatus);
  const trustProductStatus = normalizeUpper(profile.trustProductStatus);

  // Campaign: needs touching when sample messages, opt-in text, or campaign description change.
  const wouldTouchCampaign = Boolean(
    fieldsToUpdate.sampleMessages ||
      fieldsToUpdate.optInDetails ||
      fieldsToUpdate.campaignDescription
  );

  // TrustProduct: needs touching when company_type correction is required,
  // or when the issueType explicitly targets trust product / brand profile layer.
  const wouldTouchTrustProduct = Boolean(
    fieldsToUpdate.company_type ||
      issueType.toLowerCase().includes("company_type") ||
      issueType.toLowerCase().includes("trust_product") ||
      classification.toLowerCase().includes("company_type")
  );

  // Brand: only needs touching when brand is FAILED and we have something to resubmit.
  const wouldTouchBrand =
    brandStatus === "FAILED" &&
    (wouldTouchCampaign || wouldTouchTrustProduct || Object.keys(fieldsToUpdate).length > 0);

  // Chain rotation: triggered when the secondary CustomerProfile is TWILIO_APPROVED
  // and the correction touches TrustHub-level objects.
  const wouldTriggerChainRotation =
    profileStatus === "TWILIO_APPROVED" &&
    (wouldTouchBrand || wouldTouchTrustProduct || wouldTouchCampaign);

  // ── Block: chain rotation would be required ───────────────────────────────

  if (wouldTriggerChainRotation) {
    blockers.push(
      "This correction would trigger full A2P bundle chain rotation because the secondary " +
        "CustomerProfile is TWILIO_APPROVED (locked). Full chain recreation cannot be executed autonomously — " +
        "it requires deleting and rebuilding all 14 Twilio TrustHub objects."
    );
  }

  // ── Block: brand already approved and would be touched directly ───────────

  if (BRAND_APPROVED_STATUSES.has(brandStatus) && wouldTouchBrand) {
    blockers.push(
      `Brand is already ${brandStatus}. Touching the brand is forbidden when it is in an approved state. ` +
        "Only campaign-level corrections are permitted when the brand is approved."
    );
  }

  // ── Block: would require start.ts (full initial submission) ──────────────

  // If profile has no SIDs at all, the correction would need to run the full start.ts flow.
  const hasAnySid = Boolean(
    profile.profileSid ||
      profile.trustProductSid ||
      profile.brandSid ||
      profile.campaignSid ||
      profile.usa2pSid
  );
  if (!hasAnySid) {
    blockers.push(
      "A2PProfile has no Twilio SIDs. A correction requires an initial submission via start.ts first. " +
        "Autonomous dry-run simulation cannot proceed without existing SIDs."
    );
  }

  // ── Warnings ──────────────────────────────────────────────────────────────

  if (confidence < HIGH_CONFIDENCE_THRESHOLD) {
    warnings.push(
      `AI confidence is ${(confidence * 100).toFixed(0)}% (below the recommended ${HIGH_CONFIDENCE_THRESHOLD * 100}% threshold). ` +
        "Admin review strongly recommended before approving."
    );
  }

  if (brandStatus === "FAILED" && wouldTouchCampaign && !wouldTouchBrand) {
    warnings.push(
      "Brand is FAILED. Campaign-level corrections alone will not resolve brand rejection. " +
        "Brand resubmission must also be triggered."
    );
  }

  if (
    campaignSubmitAttempts >= 2 &&
    campaignSubmitAttempts < CAMPAIGN_SUBMIT_CEILING
  ) {
    const remaining = CAMPAIGN_SUBMIT_CEILING - campaignSubmitAttempts;
    warnings.push(
      `Campaign submission has been attempted ${campaignSubmitAttempts} time${campaignSubmitAttempts === 1 ? "" : "s"}. ` +
        `${remaining} attempt${remaining === 1 ? "" : "s"} remaining before the safety ceiling.`
    );
  }

  if (
    ["IN_REVIEW", "PENDING_REVIEW"].includes(trustProductStatus) &&
    wouldTouchTrustProduct
  ) {
    warnings.push(
      `TrustProduct is currently ${trustProductStatus} (locked). ` +
        "Twilio rejects entity assignments on locked TrustProducts. The correction may fail at this stage."
    );
  }

  if (profile.lastSubmittedAt) {
    const msSinceSubmit =
      simulatedAt.getTime() - new Date(profile.lastSubmittedAt).getTime();
    if (msSinceSubmit < RECENT_SUBMIT_WINDOW_MS) {
      const hoursAgo = Math.round(msSinceSubmit / (60 * 60 * 1000));
      warnings.push(
        `Profile was last submitted ${hoursAgo} hour${hoursAgo === 1 ? "" : "s"} ago. ` +
          "Rapid resubmission may trigger Twilio rate limits or instant rejection."
      );
    }
  }

  if (
    Array.isArray(pp.missingInfoNeeded) &&
    (pp.missingInfoNeeded as string[]).length > 0
  ) {
    warnings.push(
      `AI flagged missing information required from the user: ${(pp.missingInfoNeeded as string[]).join(", ")}. ` +
        "Proceeding without this information may cause rejection."
    );
  }

  const hasHighComplianceWarning = (
    Array.isArray(pp.complianceWarnings) ? pp.complianceWarnings : []
  ).some((w: any) => String(w?.severity || "").toLowerCase() === "high");
  if (hasHighComplianceWarning) {
    warnings.push(
      "AI flagged a high-severity compliance warning in the proposed payload. Manual review required before execution."
    );
  }

  if (wouldTouchTrustProduct || wouldTouchBrand) {
    warnings.push(
      "This correction touches Twilio TrustHub objects. Confirm that existing SIDs are still valid " +
        "in the Twilio Console before approving."
    );
  }

  // ── Build intended DB mutations ───────────────────────────────────────────

  const intendedDbMutations: string[] = [];

  for (const [field, diff] of Object.entries(fieldsToUpdate)) {
    const val = truncate(normalizeStr(diff.proposed), 72);
    intendedDbMutations.push(`A2PProfile.${field} ← "${val}"`);
  }

  if (wouldTouchCampaign) {
    intendedDbMutations.push(
      "A2PProfile.campaignSid ← new QE... SID (after campaign recreated)"
    );
    intendedDbMutations.push(
      "A2PProfile.usa2pSid ← same new QE... SID"
    );
    intendedDbMutations.push(
      "A2PProfile.campaignStatus ← PENDING (carrier review)"
    );
    intendedDbMutations.push(
      "A2PProfile.registrationStatus ← 'campaign_submitted'"
    );
    intendedDbMutations.push(
      "A2PProfile.campaignSubmitAttempts ← incremented by 1"
    );
    intendedDbMutations.push(
      "A2PProfile.campaignSubmitLastAttemptAt ← now"
    );
  }

  if (wouldTouchBrand) {
    intendedDbMutations.push(
      "A2PProfile.brandStatus ← PENDING (after brand.update() resubmit)"
    );
    intendedDbMutations.push(
      "A2PProfile.brandFailureReason ← cleared"
    );
    intendedDbMutations.push(
      "A2PProfile.registrationStatus ← 'brand_submitted'"
    );
    intendedDbMutations.push(
      "A2PProfile.applicationStatus ← 'pending'"
    );
  }

  if (wouldTouchTrustProduct) {
    intendedDbMutations.push(
      "A2PProfile.a2pProfileEndUserSid ← updated or new IT... SID"
    );
    intendedDbMutations.push(
      "A2PProfile.trustProductStatus ← IN_REVIEW (after re-evaluation)"
    );
  }

  intendedDbMutations.push("A2PProfile.lastSubmittedAt ← now");
  intendedDbMutations.push("AdminAiActionProposal.status ← 'executed'");
  intendedDbMutations.push(
    "AdminAiAuditLog ← new entry: { eventType: 'a2p_resubmission_executed', status: 'ok' }"
  );

  // ── Build intended Twilio actions ─────────────────────────────────────────

  const intendedTwilioActions: string[] = [];

  const tpSid = normalizeStr(profile.trustProductSid) || "TP...";
  const euSid = normalizeStr(profile.a2pProfileEndUserSid) || "IT...";
  const bnSid = normalizeStr(profile.brandSid) || "BN...";
  const qeSid =
    normalizeStr(profile.campaignSid || profile.usa2pSid) || "QE...";
  const mgSid = normalizeStr(profile.messagingServiceSid) || "MG...";

  if (wouldTouchTrustProduct) {
    intendedTwilioActions.push(
      `trusthub.v1.endUsers(${euSid}).update({ attributes: { company_type: "${proposedCompanyType || "private"}" } })` +
        " — repair A2P TrustProduct EndUser (company_type correction)"
    );
    intendedTwilioActions.push(
      `trusthub.v1.trustProducts(${tpSid}).entityAssignments.create({ objectSid: ${euSid} })` +
        " — re-assign corrected EndUser to TrustProduct"
    );
    intendedTwilioActions.push(
      `trusthub.v1.trustProducts(${tpSid}).evaluations.create({ policySid: A2P_TRUST_PRODUCT_POLICY_SID })` +
        " — trigger TrustProduct policy evaluation"
    );
    intendedTwilioActions.push(
      `trusthub.v1.trustProducts(${tpSid}).update({ status: "pending-review" })` +
        " — submit TrustProduct for Twilio review"
    );
  }

  if (wouldTouchBrand) {
    intendedTwilioActions.push(
      `messaging.v1.brandRegistrations(${bnSid}).update()` +
        " — resubmit FAILED brand for Twilio review (in-place; does NOT recreate brand SID)"
    );
  }

  if (wouldTouchCampaign) {
    intendedTwilioActions.push(
      `messaging.v1.services(${mgSid}).usAppToPerson(${qeSid}).fetch()` +
        " — verify existing campaign SID is still live"
    );
    intendedTwilioActions.push(
      `messaging.v1.services(${mgSid}).usAppToPerson(${qeSid}).remove()` +
        " — delete stale campaign (QE SIDs are not updatable; must recreate)"
    );
    intendedTwilioActions.push(
      `messaging.v1.services(${mgSid}).usAppToPerson.create({ brandRegistrationSid: ${bnSid}, messageSamples: [...corrected], messageFlow: "...corrected..." })` +
        " — create corrected campaign under existing brand"
    );
  }

  if (intendedTwilioActions.length === 0) {
    intendedTwilioActions.push(
      "No Twilio API calls required for this correction — only A2PProfile document fields would be updated."
    );
  }

  // ── Compute riskLevel ─────────────────────────────────────────────────────

  const hasBlockers = blockers.length > 0;
  let riskLevel: SimulatorOutput["riskLevel"];

  if (hasBlockers) {
    riskLevel = "blocked";
  } else if (wouldTriggerChainRotation) {
    riskLevel = "blocked"; // already in blockers, but guard here too
  } else if (wouldTouchBrand || wouldTouchTrustProduct) {
    riskLevel = "high";
  } else if (wouldTouchCampaign) {
    riskLevel = "medium";
  } else {
    riskLevel = "low";
  }

  // ── Assemble final output ─────────────────────────────────────────────────

  return {
    simulationFingerprint: fingerprint,
    simulatedAt,
    canProceed: !hasBlockers,
    riskLevel,
    requiredAdminApproval: true,
    blockers,
    warnings,

    currentState: {
      profileId,
      userEmail: targetEmail,
      messagingReady: Boolean(profile.messagingReady),
      applicationStatus: normalizeStr(profile.applicationStatus),
      registrationStatus: normalizeStr(profile.registrationStatus),
      brandSid: normalizeStr(profile.brandSid) || null,
      brandStatus: brandStatus || null,
      campaignSid: normalizeStr(profile.campaignSid || profile.usa2pSid) || null,
      campaignStatus: normalizeStr(profile.campaignStatus) || null,
      trustProductSid: normalizeStr(profile.trustProductSid) || null,
      profileSid: normalizeStr(profile.profileSid) || null,
      failure: profile.failure
        ? {
            stage: profile.failure.stage,
            simpleTitle: profile.failure.simpleTitle,
            signature: profile.failure.signature,
          }
        : null,
      profileUpdatedAt,
      lastSubmittedAt: profile.lastSubmittedAt
        ? new Date(profile.lastSubmittedAt)
        : null,
      campaignSubmitAttempts,
    },

    proposedChanges: {
      proposalId: input.proposalId,
      classification,
      confidence,
      issueType,
      likelyCause,
      fieldsToUpdate,
      wouldTriggerChainRotation,
      wouldTouchBrand,
      wouldTouchCampaign,
      wouldTouchTrustProduct,
    },

    intendedDbMutations,
    intendedTwilioActions,
    forbiddenActionsConfirmedNotUsed: FORBIDDEN,
  };
}
