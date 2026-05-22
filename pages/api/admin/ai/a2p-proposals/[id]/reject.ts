import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import AdminAiActionProposal from "@/models/AdminAiActionProposal";
import AdminAiAuditLog from "@/models/AdminAiAuditLog";
import { isAdminAiDevBypassAllowed } from "@/lib/admin-ai/devAuth";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

async function requireAdmin(req: NextApiRequest, res: NextApiResponse) {
  if (isAdminAiDevBypassAllowed(req)) return { ok: true as const, email: "dev-bypass" };
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const email = String(session?.user?.email || "").toLowerCase();
  if (!email) return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  if (email !== ADMIN_EMAIL) return { ok: false as const, status: 403 as const, error: "Forbidden" };
  return { ok: true as const, email };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const admin = await requireAdmin(req, res);
  if (!admin.ok) return res.status(admin.status).json({ ok: false, error: admin.error });

  await mongooseConnect();

  const proposalId = String(req.query.id || "").trim();
  if (!proposalId) {
    return res.status(400).json({ ok: false, error: "Missing proposal ID." });
  }

  const now = new Date();
  const adminEmail = admin.email;

  // Atomic: only succeeds when the proposal is still pending with the correct type.
  // Returns null if already rejected/approved/executed, wrong type, or not found.
  // Does NOT overwrite createdBy — that field preserves the original system/AI creator.
  const rejected: any = await (AdminAiActionProposal as any).findOneAndUpdate(
    {
      _id: proposalId,
      actionType: "a2p_resubmission",
      status: "pending",
    },
    {
      $set: {
        status:     "rejected",
        rejectedBy: adminEmail,
        rejectedAt: now,
      },
    },
    { new: true }
  );

  if (!rejected) {
    // Either not found, wrong action type, or no longer pending.
    const existing: any = await (AdminAiActionProposal as any)
      .findById(proposalId)
      .select("status actionType")
      .lean();

    if (!existing) {
      return res.status(404).json({ ok: false, error: "Proposal not found." });
    }
    if (existing.actionType !== "a2p_resubmission") {
      return res.status(400).json({ ok: false, error: "Unsupported proposal type." });
    }
    return res.status(409).json({
      ok: false,
      error: `Proposal is not in pending state (current: ${existing.status}). Only pending proposals can be rejected.`,
    });
  }

  // Audit log — fire-and-forget. Rejection is already committed; a log failure
  // must not roll back or fail the response.
  try {
    await AdminAiAuditLog.create({
      targetUserId:    rejected.targetUserId,
      targetUserEmail: rejected.targetUserEmail,
      adminEmail,
      source:          "a2p_failure_detector",
      taskType:        "a2p_resubmission",
      eventType:       "a2p_proposal_rejected",
      status:          "ok",
      inputSummary:    `Proposal ${proposalId} rejected by ${adminEmail}.`,
      metadata:        { proposalId },
    });
  } catch {
    // Non-fatal — rejection is already persisted.
  }

  return res.status(200).json({ ok: true, status: "rejected" });
}
