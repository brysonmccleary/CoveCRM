import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import AdminAiActionProposal from "@/models/AdminAiActionProposal";
import { isAdminAiDevBypassAllowed } from "@/lib/admin-ai/devAuth";
import { simulateA2PResubmission } from "@/lib/a2p/a2pDryRunSimulator";
import { executeA2PResubmission } from "@/lib/a2p/a2pResubmissionExecutor";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";
const SIMULATION_MAX_AGE_MS = 5 * 60 * 1000;  // 5 minutes
const LOCK_TTL_MS          = 10 * 60 * 1000;  // 10 minutes

async function requireAdmin(req: NextApiRequest, res: NextApiResponse) {
  if (isAdminAiDevBypassAllowed(req)) return { ok: true as const, email: "dev-bypass" };
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const email = String(session?.user?.email || "").toLowerCase();
  if (!email) return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  if (email !== ADMIN_EMAIL) return { ok: false as const, status: 403 as const, error: "Forbidden" };
  return { ok: true as const, email };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ── PHASE 1: Perimeter ─────────────────────────────────────────────────────

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const admin = await requireAdmin(req, res);
  if (!admin.ok) return res.status(admin.status).json({ ok: false, error: admin.error });

  // ── PHASE 2: Input validation ───────────────────────────────────────────────

  const body = req.body || {};
  const simulationFingerprint = String(body.simulationFingerprint || "").trim();
  const simulatedAtRaw        = String(body.simulatedAt || "").trim();

  if (!simulationFingerprint) {
    return res.status(400).json({ ok: false, error: "simulationFingerprint is required." });
  }
  if (!simulatedAtRaw) {
    return res.status(400).json({ ok: false, error: "simulatedAt is required." });
  }

  const simulatedAt = new Date(simulatedAtRaw);
  if (isNaN(simulatedAt.getTime())) {
    return res.status(400).json({ ok: false, error: "simulatedAt is not a valid ISO date." });
  }

  const simulationAgeMs = Date.now() - simulatedAt.getTime();
  if (simulationAgeMs > SIMULATION_MAX_AGE_MS) {
    const ageMinutes = Math.floor(simulationAgeMs / 60000);
    return res.status(400).json({
      ok: false,
      error: `Simulation is ${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} old. Re-run the dry-run simulation before approving (limit: 5 minutes).`,
    });
  }

  // ── PHASE 3: Load and validate proposal ────────────────────────────────────

  await mongooseConnect();

  const proposalId = String(req.query.id || "").trim();
  if (!proposalId) {
    return res.status(400).json({ ok: false, error: "Missing proposal ID." });
  }

  const proposal = await AdminAiActionProposal.findById(proposalId);
  if (!proposal) {
    return res.status(404).json({ ok: false, error: "Proposal not found." });
  }
  if (proposal.actionType !== "a2p_resubmission") {
    return res.status(400).json({ ok: false, error: "Unsupported proposal type." });
  }
  if ((proposal as any).status !== "pending") {
    return res.status(409).json({
      ok: false,
      error: `Proposal is not in pending state (current: ${(proposal as any).status}). Only pending proposals can be approved.`,
    });
  }

  // ── PHASE 4: Simulation attestation ────────────────────────────────────────
  // Re-run the simulator fresh server-side. The submitted fingerprint must match
  // the fresh fingerprint, proving the profile has not changed since the admin
  // viewed the dry-run result.

  let freshSimulation: Awaited<ReturnType<typeof simulateA2PResubmission>>;
  try {
    freshSimulation = await simulateA2PResubmission({
      proposalId,
      requestedBy: admin.email,
    });
  } catch (err: any) {
    console.error("[approve] simulateA2PResubmission failed:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Safety simulation failed unexpectedly." });
  }

  if (freshSimulation.simulationFingerprint !== simulationFingerprint) {
    return res.status(409).json({
      ok: false,
      error: "Profile state changed since this simulation was run. Re-run the dry-run simulation before approving.",
      freshFingerprint: freshSimulation.simulationFingerprint,
    });
  }

  if (!freshSimulation.canProceed) {
    return res.status(400).json({
      ok: false,
      error: "Simulation has active blockers — approval is not permitted.",
      blockers: freshSimulation.blockers,
    });
  }

  // ── PHASE 5: Atomic lock acquisition ───────────────────────────────────────
  // findOneAndUpdate with status: "pending" in the filter prevents concurrent
  // approvals. The lock fields, attestation fields, and attempt counter are
  // written in a single atomic operation.

  const now      = new Date();
  const lockUntil = new Date(now.getTime() + LOCK_TTL_MS);
  const adminEmail = admin.email;

  const locked: any = await (AdminAiActionProposal as any).findOneAndUpdate(
    {
      _id: proposalId,
      status: "pending",
      $or: [
        { resubmitLockUntil: { $exists: false } },
        { resubmitLockUntil: null },
        { resubmitLockUntil: { $lt: now } },
      ],
    },
    {
      $set: {
        resubmitLockUntil:          lockUntil,
        resubmitLockedBy:           adminEmail,
        approvedBy:                 adminEmail,
        approvedAt:                 now,
        lastSimulationFingerprint:  simulationFingerprint,
        lastSimulationAt:           simulatedAt,
      },
      $inc: { resubmitAttempts: 1 },
    },
    { new: true }
  );

  if (!locked) {
    return res.status(409).json({
      ok: false,
      error: "Proposal is locked for execution by another process, or is no longer pending.",
    });
  }

  // ── PHASE 6: Execute (proposal status set ONLY after executor resolves) ─────
  // Lock is always released in finally. Executor stub behavior is preserved.

  let execution: any = { ok: false, status: "executor_not_started" };
  let executorThrewException = false;

  try {
    execution = await executeA2PResubmission({ proposalId, approvedBy: adminEmail });

    // Set status based on executor outcome — never set to "approved" before this point.
    if (execution.ok) {
      locked.status    = "approved";
      locked.executedAt = new Date();
    } else {
      locked.status   = "failed";
      locked.failedAt = new Date();
      locked.lastError = String(execution.status || "executor_failed").slice(0, 240);
    }
    locked.executionResult = execution;
    await locked.save();
  } catch (err: any) {
    executorThrewException = true;
    execution = { ok: false, status: "executor_exception" };
    locked.status         = "failed";
    locked.failedAt       = new Date();
    locked.lastError      = String(err?.message || err || "executor_exception").slice(0, 240);
    locked.executionResult = execution;
    try { await locked.save(); } catch { /* best effort */ }
    console.error("[approve] executeA2PResubmission threw:", err?.message || err);
  } finally {
    // Always unset the lock — TTL expiry is the fallback if this fails.
    try {
      await (AdminAiActionProposal as any).updateOne(
        { _id: proposalId },
        { $unset: { resubmitLockUntil: 1, resubmitLockedBy: 1 } }
      );
    } catch { /* best effort */ }
  }

  if (executorThrewException) {
    return res.status(500).json({ ok: false, error: "Executor failed unexpectedly.", status: execution.status });
  }

  return res.status(200).json({ ok: true, status: execution.status, execution });
}
