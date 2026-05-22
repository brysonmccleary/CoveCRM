import crypto from "crypto";
import mongooseConnect from "@/lib/mongooseConnect";
import AdminAiActionProposal from "@/models/AdminAiActionProposal";
import AdminAiAuditLog from "@/models/AdminAiAuditLog";
import A2PProfile from "@/models/A2PProfile";

const CAMPAIGN_SUBMIT_CEILING = 3;

// ── Fingerprint algorithm ──────────────────────────────────────────────────────
// Must be byte-for-byte identical to computeFingerprint() in a2pDryRunSimulator.ts.
// Both functions hash: proposalId | profileUpdatedAt.toISOString() | proposalCreatedAt.toISOString()
function recomputeFingerprint(
  proposalId: string,
  profileUpdatedAt: Date,
  proposalCreatedAt: Date
): string {
  return crypto
    .createHash("sha256")
    .update(
      [proposalId, profileUpdatedAt.toISOString(), proposalCreatedAt.toISOString()].join("|")
    )
    .digest("hex")
    .slice(0, 32);
}

// ── Audit log helper ───────────────────────────────────────────────────────────
// Fire-and-forget: audit log failures must never block or fail execution.
function writeAuditLog(
  proposal: any,
  adminEmail: string,
  eventType: string,
  status: string,
  meta?: Record<string, any>
): void {
  AdminAiAuditLog.create({
    targetUserId:    proposal.targetUserId,
    targetUserEmail: proposal.targetUserEmail,
    adminEmail,
    source:       "a2p_failure_detector",
    taskType:     "a2p_resubmission",
    eventType,
    status,
    inputSummary: `Proposal ${String(proposal._id)} — ${eventType}`,
    metadata:     { proposalId: String(proposal._id), ...meta },
  }).catch(() => { /* non-fatal */ });
}

// ── Executor ───────────────────────────────────────────────────────────────────

export async function executeA2PResubmission({
  proposalId,
  approvedBy,
}: {
  proposalId: string;
  approvedBy?: string;
}) {
  await mongooseConnect();

  const caller = approvedBy || "";
  const now    = new Date();
  const steps: any[] = [];

  const step = (name: string, status: string, extra?: Record<string, any>) => {
    steps.push({ step: name, status, at: new Date(), ...extra });
  };

  // ── PHASE A: Re-read proposal + lock verification ──────────────────────────
  // Defense-in-depth: executor independently re-reads and re-validates the
  // proposal, independent of the checks approve.ts already performed.

  const proposal: any = await AdminAiActionProposal.findById(proposalId);
  if (!proposal) {
    return { ok: false, status: "proposal_not_found", phase: "A", gate: "proposal_exists" };
  }
  if (proposal.actionType !== "a2p_resubmission") {
    return {
      ok: false, status: "preflight_failed", phase: "A", gate: "action_type",
      reason: `Unexpected actionType: ${proposal.actionType}`,
    };
  }

  // Write "entered" audit log as soon as we have proposal context.
  writeAuditLog(proposal, caller, "a2p_executor_entered", "attempting", {
    autoResubmitEnabled: process.env.A2P_AUTO_RESUBMIT_ENABLED === "true",
  });
  step("executor_entered", "ok");

  // Status must still be "pending" — approve.ts sets it AFTER the executor returns.
  if (proposal.status !== "pending") {
    step("proposal_verified", "blocked", { gate: "status", found: proposal.status });
    writeAuditLog(proposal, caller, "a2p_executor_preflight_failed", "blocked", {
      gate: "status", found: proposal.status,
    });
    return {
      ok: false, status: "preflight_failed", phase: "A", gate: "status",
      reason: `Expected pending, found: ${proposal.status}`,
    };
  }

  // Lock must be present, unexpired, and owned.
  if (!proposal.resubmitLockUntil) {
    step("proposal_verified", "blocked", { gate: "lock_missing" });
    writeAuditLog(proposal, caller, "a2p_executor_preflight_failed", "blocked", { gate: "lock_missing" });
    return {
      ok: false, status: "preflight_failed", phase: "A", gate: "lock_missing",
      reason: "No resubmitLockUntil — lock was not acquired before calling executor",
    };
  }
  if (new Date(proposal.resubmitLockUntil).getTime() <= now.getTime()) {
    step("proposal_verified", "blocked", { gate: "lock_expired" });
    writeAuditLog(proposal, caller, "a2p_executor_preflight_failed", "blocked", { gate: "lock_expired" });
    return {
      ok: false, status: "preflight_failed", phase: "A", gate: "lock_expired",
      reason: "resubmitLockUntil is in the past — lock expired before executor ran",
    };
  }
  if (!proposal.resubmitLockedBy) {
    step("proposal_verified", "blocked", { gate: "lock_owner_missing" });
    writeAuditLog(proposal, caller, "a2p_executor_preflight_failed", "blocked", { gate: "lock_owner_missing" });
    return {
      ok: false, status: "preflight_failed", phase: "A", gate: "lock_owner_missing",
      reason: "resubmitLockedBy is not set",
    };
  }

  step("proposal_verified", "ok");

  // ── PHASE B: Reload A2PProfile + state verification ───────────────────────
  // Fresh read — never trust a cached profile. State may have changed between
  // approve.ts's simulation check and this executor entry.

  const profile: any = await A2PProfile.findOne({
    userEmail: String(proposal.targetUserEmail).toLowerCase(),
  }).lean();

  if (!profile) {
    step("profile_verified", "blocked", { gate: "profile_not_found" });
    writeAuditLog(proposal, caller, "a2p_executor_preflight_failed", "blocked", { gate: "profile_not_found" });
    return {
      ok: false, status: "preflight_failed", phase: "B", gate: "profile_not_found",
      reason: "A2PProfile not found for target user",
    };
  }

  if (profile.messagingReady === true) {
    step("profile_verified", "blocked", { gate: "already_messaging_ready" });
    writeAuditLog(proposal, caller, "a2p_executor_preflight_failed", "blocked", { gate: "already_messaging_ready" });
    return {
      ok: false, status: "preflight_failed", phase: "B", gate: "already_messaging_ready",
      reason: "A2PProfile.messagingReady is true — resubmission is not needed",
    };
  }

  if (String(profile.applicationStatus || "").toLowerCase() === "approved") {
    step("profile_verified", "blocked", { gate: "already_approved" });
    writeAuditLog(proposal, caller, "a2p_executor_preflight_failed", "blocked", { gate: "already_approved" });
    return {
      ok: false, status: "preflight_failed", phase: "B", gate: "already_approved",
      reason: "A2PProfile.applicationStatus is approved",
    };
  }

  const campaignSubmitAttempts = Number(profile.campaignSubmitAttempts || 0);
  if (campaignSubmitAttempts >= CAMPAIGN_SUBMIT_CEILING) {
    step("profile_verified", "blocked", { gate: "campaign_ceiling", attempts: campaignSubmitAttempts });
    writeAuditLog(proposal, caller, "a2p_executor_preflight_failed", "blocked", {
      gate: "campaign_ceiling", attempts: campaignSubmitAttempts,
    });
    return {
      ok: false, status: "preflight_failed", phase: "B", gate: "campaign_ceiling",
      reason: `Campaign submit ceiling reached (${campaignSubmitAttempts}/${CAMPAIGN_SUBMIT_CEILING})`,
    };
  }

  step("profile_verified", "ok", { campaignSubmitAttempts });

  // ── PHASE C: Fingerprint revalidation (TOCTOU defense) ────────────────────
  // Recomputes the fingerprint using the exact same algorithm as
  // a2pDryRunSimulator.ts. A mismatch means the A2PProfile changed between
  // the simulation run and the executor entry — the simulator's assessment
  // is no longer valid and execution must be aborted.

  const profileUpdatedAt  = profile.updatedAt ? new Date(profile.updatedAt) : new Date(profile.createdAt || now);
  const proposalCreatedAt = new Date(proposal.createdAt);
  const freshFingerprint  = recomputeFingerprint(proposalId, profileUpdatedAt, proposalCreatedAt);
  const storedFingerprint = String(proposal.lastSimulationFingerprint || "");

  if (!storedFingerprint) {
    step("fingerprint_verified", "blocked", { gate: "no_simulation_fingerprint" });
    writeAuditLog(proposal, caller, "a2p_executor_preflight_failed", "blocked", { gate: "no_simulation_fingerprint" });
    return {
      ok: false, status: "preflight_failed", phase: "C", gate: "no_simulation_fingerprint",
      reason: "No lastSimulationFingerprint on proposal — dry-run was never run before approval",
    };
  }

  if (freshFingerprint !== storedFingerprint) {
    step("fingerprint_verified", "blocked", { gate: "fingerprint_mismatch", fresh: freshFingerprint, stored: storedFingerprint });
    writeAuditLog(proposal, caller, "a2p_executor_preflight_failed", "blocked", {
      gate: "fingerprint_mismatch", freshFingerprint,
    });
    return {
      ok: false, status: "preflight_failed", phase: "C", gate: "fingerprint_mismatch",
      reason: "A2PProfile changed since simulation was run — fingerprints do not match",
      freshFingerprint,
    };
  }

  step("fingerprint_verified", "ok", { fingerprint: freshFingerprint });

  // ── PHASE D: Snapshot + steps persistence ─────────────────────────────────
  // Pre-execution snapshot captures full profile and proposal state immediately
  // before any mutation. Required for forensic recovery if execution partially
  // succeeds. Steps are persisted once here, not incrementally.

  const preExecutionSnapshot = {
    capturedAt: now,
    proposal: {
      id:                        proposalId,
      status:                    proposal.status,
      actionType:                proposal.actionType,
      classification:            String(proposal.proposedPayload?.classification || ""),
      confidence:                Number(proposal.confidence || 0),
      resubmitAttempts:          Number(proposal.resubmitAttempts || 0),
      lastSimulationFingerprint: storedFingerprint,
      lastSimulationAt:          proposal.lastSimulationAt || null,
      approvedBy:                proposal.approvedBy || caller,
    },
    profile: {
      id:                    String(profile._id),
      messagingReady:        Boolean(profile.messagingReady),
      applicationStatus:     String(profile.applicationStatus || ""),
      registrationStatus:    String(profile.registrationStatus || ""),
      brandStatus:           String(profile.brandStatus || ""),
      brandSid:              String(profile.brandSid || ""),
      campaignSid:           String(profile.campaignSid || profile.usa2pSid || ""),
      campaignStatus:        String(profile.campaignStatus || ""),
      trustProductSid:       String(profile.trustProductSid || ""),
      profileSid:            String(profile.profileSid || ""),
      campaignSubmitAttempts,
      profileUpdatedAt:      profile.updatedAt || null,
    },
  };

  step("snapshot_taken", "ok");

  // Persist steps and snapshot via updateOne/$set to avoid conflicting with
  // approve.ts's locked.save() which operates on a different document instance.
  await (AdminAiActionProposal as any).updateOne(
    { _id: proposalId },
    { $set: { executionSteps: steps, preExecutionSnapshot } }
  ).catch(() => { /* non-fatal — observability loss is better than blocking */ });

  // ── STUB BEHAVIOR — Phases E–H not yet implemented ────────────────────────
  // All preflight gates passed. The env-flag gate below is the only remaining
  // barrier before live Twilio execution (which is not yet wired).

  if (String(process.env.A2P_AUTO_RESUBMIT_ENABLED || "").toLowerCase() !== "true") {
    writeAuditLog(proposal, caller, "a2p_executor_pending_manual", "ok", {
      reason: "A2P_AUTO_RESUBMIT_ENABLED is not true — deferred to manual resubmission",
    });
    return { ok: true, status: "approved_pending_manual_resubmission" };
  }

  // Flag is true but the live execution path is not yet connected.
  writeAuditLog(proposal, caller, "a2p_executor_not_connected", "blocked", {
    reason: "Executor stub — live Twilio execution path not yet implemented",
  });
  return { ok: false, status: "resubmission_executor_not_connected" };
}
