import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import AdminAiActionProposal from "@/models/AdminAiActionProposal";
import AdminAiAuditLog from "@/models/AdminAiAuditLog";
import SupportEmailDraft from "@/models/SupportEmailDraft";
import { buildSupportContext } from "@/lib/ai/support/supportContext";
import {
  generateA2PCorrection,
  validateA2PCorrectionPayload,
  type A2PCorrectionDraft,
} from "@/lib/admin-ai/a2pCorrectionService";
import { canAutoExecuteA2PFix, getRiskLevel } from "@/lib/admin-ai/safety";
import { executeA2PResubmission } from "./a2pResubmissionExecutor";

type A2PFailureInput = {
  userId?: string;
  userEmail?: string;
  a2pRecord?: any;
  rejectionReason?: string;
  source?: string;
};

function normalizeFailureText(value: any) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value || "").trim();
  }
}

function isFailedStatus(value: any) {
  return ["failed", "rejected", "declined", "not_found", "noncompliant", "non-compliant"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function getA2PRejectionReason(a2pRecord: any, explicit?: string) {
  return (
    normalizeFailureText(explicit) ||
    normalizeFailureText(a2pRecord?.declinedReason) ||
    normalizeFailureText(a2pRecord?.brandFailureReason) ||
    normalizeFailureText(a2pRecord?.brandErrorsText) ||
    normalizeFailureText(a2pRecord?.brandErrors) ||
    normalizeFailureText(a2pRecord?.lastError) ||
    "A2P registration was rejected or failed."
  );
}

function fingerprint(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 180);
}

export function detectA2PFailure(input: string | A2PFailureInput, a2pRecord?: any) {
  const record = a2pRecord || (typeof input === "object" ? input.a2pRecord : null) || {};
  const explicitReason = typeof input === "object" ? input.rejectionReason : "";
  const userEmail = typeof input === "string" && input.includes("@") ? input.toLowerCase() : (input as A2PFailureInput)?.userEmail;
  const userId = typeof input === "string" && !input.includes("@") ? input : (input as A2PFailureInput)?.userId;

  const failed =
    isFailedStatus(record?.registrationStatus) ||
    isFailedStatus(record?.applicationStatus) ||
    isFailedStatus(record?.brandStatus) ||
    isFailedStatus(record?.campaignStatus) ||
    Boolean(record?.lastError && isFailedStatus(record?.brandStatus || record?.registrationStatus));

  return {
    failed,
    userId: userId ? String(userId) : String(record?.userId || ""),
    userEmail: String(userEmail || record?.userEmail || "").toLowerCase(),
    status: String(record?.registrationStatus || record?.applicationStatus || record?.brandStatus || record?.campaignStatus || ""),
    rejectionReason: failed ? getA2PRejectionReason(record, explicitReason) : "",
  };
}

async function audit(args: {
  context?: any;
  eventType: string;
  taskType?: string;
  provider?: string;
  status?: string;
  inputSummary?: string;
  outputSummary?: string;
  proposedActions?: any[];
  error?: string;
  metadata?: any;
}) {
  const userId = args.context?.user?.id || args.context?.a2p?.userId || "";
  const userEmail = args.context?.user?.email || "";
  await AdminAiAuditLog.create({
    userId,
    userEmail,
    targetUserId: userId,
    targetUserEmail: userEmail,
    source: "a2p_failure_detector",
    taskType: args.taskType || "a2p_failure",
    provider: args.provider || "",
    inputSummary: args.inputSummary || "",
    outputSummary: args.outputSummary || "",
    proposedActions: args.proposedActions,
    status: args.status || "ok",
    error: args.error || "",
    eventType: args.eventType,
    metadata: args.metadata || {},
  });
}

export async function buildA2PFailureContext(input: A2PFailureInput) {
  await mongooseConnect();
  const user =
    input.userId
      ? await User.findById(input.userId).lean()
      : input.userEmail
      ? await (User as any).findOne({ email: String(input.userEmail).toLowerCase() }).lean()
      : null;
  const profile =
    input.a2pRecord ||
    (user?._id ? await A2PProfile.findOne({ userId: String(user._id) }).lean() : null) ||
    (input.userEmail ? await A2PProfile.findOne({ userEmail: String(input.userEmail).toLowerCase() }).lean() : null);
  const failure = detectA2PFailure(
    { userId: user?._id ? String(user._id) : String(profile?.userId || input.userId || ""), userEmail: user?.email || input.userEmail, rejectionReason: input.rejectionReason },
    profile
  );
  const supportContext = user?.email ? await buildSupportContext(String(user.email).toLowerCase()).catch(() => null) : null;

  return {
    user: user
      ? {
          id: String(user._id || profile?.userId || ""),
          email: String(user.email || profile?.userEmail || input.userEmail || "").toLowerCase(),
          name: user.name || "",
          businessName: user.businessName || profile?.businessName || "",
          website: user.website || profile?.website || "",
          a2p: user.a2p || {},
        }
      : null,
    a2p: profile
      ? {
          id: String(profile._id || ""),
          userId: String(profile.userId || user?._id || ""),
          businessName: profile.businessName || "",
          einPresent: Boolean(profile.ein),
          website: profile.website || "",
          usecaseCode: profile.usecaseCode || "",
          sampleMessages: profile.sampleMessagesArr || profile.sampleMessages || "",
          optInDetails: profile.optInDetails || "",
          optInScreenshotUrl: profile.optInScreenshotUrl || "",
          landingOptInUrl: profile.landingOptInUrl || "",
          landingTosUrl: profile.landingTosUrl || "",
          landingPrivacyUrl: profile.landingPrivacyUrl || "",
          brandSid: profile.brandSid || "",
          campaignSid: profile.campaignSid || profile.usa2pSid || "",
          messagingServiceSid: profile.messagingServiceSid || "",
          brandStatus: profile.brandStatus || "",
          campaignStatus: profile.campaignStatus || "",
          registrationStatus: profile.registrationStatus || "",
          applicationStatus: profile.applicationStatus || "",
          messagingReady: Boolean(profile.messagingReady),
          lastError: profile.lastError || "",
          brandFailureReason: profile.brandFailureReason || "",
          brandErrorsText: profile.brandErrorsText || "",
          declinedReason: profile.declinedReason || "",
          lastSubmittedInputs: profile.lastSubmittedInputs || null,
        }
      : null,
    failure,
    supportContext,
    source: input.source || "a2p_failure_detector",
  };
}

async function findRecentHandled(context: any) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const targetUserId = String(context?.user?.id || context?.a2p?.userId || "");
  const reason = fingerprint(context?.failure?.rejectionReason || "");
  const status = String(context?.failure?.status || "");
  if (!targetUserId) return null;
  return AdminAiActionProposal.findOne({
    targetUserId,
    actionType: "a2p_resubmission",
    source: "a2p_failure_detector",
    createdAt: { $gte: since },
    "proposedPayload.rejectionFingerprint": reason,
    "proposedPayload.failureStatus": status,
    status: { $in: ["pending", "approved", "executed"] },
  }).sort({ updatedAt: -1 });
}

async function findEmailDraftForProposal(proposalId: string) {
  if (!proposalId) return null;
  return SupportEmailDraft.findOne({
    relatedProposalId: proposalId,
    source: "a2p_failure",
    status: { $in: ["draft", "queued", "sent"] },
  }).sort({ updatedAt: -1 });
}

export async function markAlreadyHandled(context: any, proposal: any) {
  await audit({
    context,
    eventType: "a2p_failure_already_handled",
    status: "skipped",
    outputSummary: "Recent matching A2P proposal already exists.",
    metadata: { proposalId: proposal?._id ? String(proposal._id) : "" },
  });
}

export async function generateA2PCorrectionWithAI(context: any) {
  return generateA2PCorrection({
    user: context.user,
    a2pRecord: context.a2p,
    rejectionReason: context.failure?.rejectionReason,
    existingSubmission: context.a2p?.lastSubmittedInputs,
    supportContext: context.supportContext,
  });
}

export async function createA2PFailureProposal(context: any, aiDraft: A2PCorrectionDraft) {
  const targetUserId = String(context?.user?.id || context?.a2p?.userId || "");
  const targetUserEmail = String(context?.user?.email || "").toLowerCase();
  if (!targetUserId || !targetUserEmail) throw new Error("Missing target user for A2P proposal");

  const autoGate = canAutoExecuteA2PFix({
    classification: aiDraft.classification,
    confidence: aiDraft.confidence,
    attempts: 0,
    missingInfoNeeded: aiDraft.missingInfoNeeded,
    complianceWarnings: aiDraft.complianceWarnings,
    correctedPayloadValid: validateA2PCorrectionPayload(aiDraft),
  });

  const proposedPayload = {
    ...aiDraft.proposedPayload,
    classification: aiDraft.classification,
    issueType: aiDraft.issueType,
    likelyCause: aiDraft.likelyCause,
    correctedCampaignDescription: aiDraft.correctedCampaignDescription,
    correctedOptInDescription: aiDraft.correctedOptInDescription,
    correctedSampleMessages: aiDraft.correctedSampleMessages,
    correctedPrivacyPolicyNotes: aiDraft.correctedPrivacyPolicyNotes,
    correctedTermsNotes: aiDraft.correctedTermsNotes,
    missingInfoNeeded: aiDraft.missingInfoNeeded,
    complianceWarnings: aiDraft.complianceWarnings,
    rejectionReason: aiDraft.rejectionReason,
    rejectionFingerprint: fingerprint(context?.failure?.rejectionReason || aiDraft.rejectionReason),
    failureStatus: String(context?.failure?.status || ""),
    autoGate,
    originalA2PProfileId: context?.a2p?.id || "",
  };

  const existing = await findRecentHandled(context);
  if (existing) {
    await markAlreadyHandled(context, existing);
    return existing;
  }

  const proposal = await AdminAiActionProposal.create({
    targetUserId,
    targetUserEmail,
    actionType: "a2p_resubmission",
    riskLevel: getRiskLevel("a2p_resubmission"),
    title: `Review ${aiDraft.classification} A2P correction`,
    explanation: aiDraft.internalAdminSummary || aiDraft.likelyCause || "A2P failure detected. Review corrected content before resubmission.",
    proposedPayload,
    status: "pending",
    createdBy: "system",
    source: "a2p_failure_detector",
    autoEligible: autoGate.allowed,
    confidence: aiDraft.confidence,
  });

  await audit({
    context,
    eventType: "proposal_created",
    taskType: "a2p_resubmission",
    outputSummary: proposal.explanation,
    proposedActions: [{ actionType: "a2p_resubmission", proposalId: String(proposal._id), autoEligible: autoGate.allowed }],
    metadata: { proposalId: String(proposal._id), autoGate },
  });
  return proposal;
}

export async function createSupportEmailDraft(context: any, aiDraft: A2PCorrectionDraft, proposal?: any) {
  const userId = String(context?.user?.id || context?.a2p?.userId || "");
  const userEmail = String(context?.user?.email || "").toLowerCase();
  if (!userId || !userEmail) throw new Error("Missing user for support email draft");

  const relatedProposalId = proposal?._id ? String(proposal._id) : "";
  const existing = relatedProposalId
    ? await SupportEmailDraft.findOne({ relatedProposalId, source: "a2p_failure", status: { $in: ["draft", "queued"] } })
    : null;
  if (existing) return existing;

  const missingInfo = Array.isArray(aiDraft.missingInfoNeeded) ? aiDraft.missingInfoNeeded : [];
  const missingLower = missingInfo.map((item) => String(item || "").toLowerCase());
  const missingBullets = [
    missingLower.some((item) => item.includes("website")) ? "Business website URL" : "",
    missingLower.some((item) => item.includes("privacy")) ? "Privacy policy URL" : "",
    missingLower.some((item) => item.includes("terms") || item.includes("tos")) ? "Terms of service URL" : "",
  ].filter(Boolean);
  const deterministicMissingInfoBody = missingBullets.length
    ? [
        "Hi there,",
        "",
        "We’re close to finishing your CoveCRM texting approval, but we need a few details before we can complete it:",
        "",
        ...missingBullets.map((item) => `• ${item}`),
        "",
        "Once you send those over, we’ll prepare the corrected texting submission and take care of the next step for you.",
        "",
        "Thanks,",
        "CoveCRM Support",
      ].join("\n")
    : "";

  const draft = await SupportEmailDraft.create({
    userId,
    userEmail,
    to: userEmail,
    subject: aiDraft.customerEmailSubject || "Update on your CoveCRM A2P messaging registration",
    body:
      deterministicMissingInfoBody ||
      aiDraft.customerEmailBody ||
      "We detected that your A2P messaging registration needs attention. A CoveCRM admin will review the correction before anything is resubmitted.",
    source: "a2p_failure",
    status: proposal?.autoEligible && process.env.SUPPORT_EMAIL_SEND_ENABLED === "true" ? "queued" : "draft",
    relatedProposalId,
    autoEligible: Boolean(proposal?.autoEligible),
  });

  await audit({
    context,
    eventType: "email_draft_created",
    taskType: "send_support_email",
    proposedActions: [{ actionType: "send_support_email", draftId: String(draft._id), autoEligible: draft.autoEligible }],
    metadata: { draftId: String(draft._id), proposalId: relatedProposalId },
  });
  return draft;
}

export const maybeQueueSupportEmailDraft = createSupportEmailDraft;

export async function maybeHandleA2PFailure(input: A2PFailureInput | string, a2pRecord?: any) {
  try {
    const normalized: A2PFailureInput =
      typeof input === "string"
        ? { userEmail: input.includes("@") ? input : undefined, userId: !input.includes("@") ? input : undefined, a2pRecord }
        : { ...input, a2pRecord: input.a2pRecord || a2pRecord };
    const detection = detectA2PFailure(normalized, normalized.a2pRecord);
    if (!detection.failed) return { ok: true, skipped: true, reason: "not_failed" };

    const context = await buildA2PFailureContext({ ...normalized, rejectionReason: normalized.rejectionReason || detection.rejectionReason });
    await audit({
      context,
      eventType: "a2p_failure_detected",
      inputSummary: detection.rejectionReason,
      metadata: { source: normalized.source || "unknown" },
    });

    const existing = await findRecentHandled(context);
    if (existing) {
      await markAlreadyHandled(context, existing);
      const existingDraft = await findEmailDraftForProposal(String(existing._id));
      return {
        ok: true,
        skipped: true,
        reason: "already_handled",
        proposalId: String(existing._id),
        emailDraftId: existingDraft?._id ? String(existingDraft._id) : "",
        proposal: existing,
        emailDraft: existingDraft,
        autoEligible: Boolean(existing.autoEligible),
        classification: existing.proposedPayload?.classification || "",
        confidence: Number(existing.confidence || 0),
      };
    }

    const aiDraft = await generateA2PCorrectionWithAI(context);
    await audit({
      context,
      eventType: "ai_correction_generated",
      provider: aiDraft.provider,
      status: "ok",
      outputSummary: aiDraft.internalAdminSummary,
      metadata: { classification: aiDraft.classification, issueType: aiDraft.issueType, confidence: aiDraft.confidence },
    });
    const proposal = await createA2PFailureProposal(context, aiDraft);
    const emailDraft = await createSupportEmailDraft(context, aiDraft, proposal);

    let execution: any = null;
    if (proposal.autoEligible) {
      execution = await executeA2PResubmission({ proposalId: String(proposal._id), approvedBy: "system" });
      proposal.executionResult = execution;
      await proposal.save();
    }

    return {
      ok: true,
      skipped: false,
      proposalId: String(proposal._id),
      emailDraftId: String(emailDraft._id),
      proposal,
      emailDraft,
      autoEligible: Boolean(proposal.autoEligible),
      classification: proposal.proposedPayload?.classification || "",
      confidence: Number(proposal.confidence || 0),
      execution,
    };
  } catch (err: any) {
    console.warn("[a2pFailureAutomation] skipped:", err?.message || err);
    return { ok: false, skipped: true, error: String(err?.message || err).slice(0, 180) };
  }
}
