import type { NextApiRequest, NextApiResponse } from "next";
import { authenticateCompanion } from "@/lib/recruiting/companion/auth";
import { normalizeProfileUrl } from "@/lib/recruiting/social/policy";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";

const FAILURE_CODES = new Set([
  "not_logged_in",
  "target_mismatch",
  "target_ambiguous",
  "control_missing",
  "control_ambiguous",
  "platform_changed",
  "unsupported_action",
  "execution_error",
  "already_following",
  "follows_you",
  "prior_conversation",
  "prior_cove_dm",
  "connection_pending",
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const companion = await authenticateCompanion(req);
  if (!companion) return res.status(401).json({ error: "Invalid companion token." });
  const jobId = String(req.body?.jobId || "");
  const outcome = req.body?.outcome === "succeeded" ? "succeeded" : req.body?.outcome === "skipped" ? "skipped" : "failed";
  const recipientLock = String(req.body?.recipientLock || "");
  const pageUrl = String(req.body?.pageUrl || "");
  const failureCode = outcome !== "succeeded" && FAILURE_CODES.has(String(req.body?.failureCode))
    ? String(req.body.failureCode)
    : outcome !== "succeeded" ? "execution_error" : "";
  const resultSummary = String(req.body?.resultSummary || "").slice(0, 500);
  const now = new Date();

  const job = await RecruitingCompanionJob.findOne({
    _id: jobId,
    ownerEmail: companion.ownerEmail,
    companionId: companion._id,
    status: "claimed",
    leaseExpiresAt: { $gte: now },
  });
  if (!job) return res.status(409).json({ error: "Job lease is missing or expired." });
  if (recipientLock !== job.recipientLock) return res.status(400).json({ error: "Recipient lock mismatch." });

  let normalizedPageUrl = "";
  try {
    normalizedPageUrl = normalizeProfileUrl(job.platform as "linkedin" | "instagram", pageUrl);
  } catch {
    return res.status(400).json({ error: "Completion page URL is invalid." });
  }
  if (normalizedPageUrl !== job.targetSnapshot?.profileUrl) {
    return res.status(400).json({ error: "Completion page does not match the locked target." });
  }

  const shouldDefer = outcome === "failed" && failureCode === "connection_pending" && job.attempts < 14;
  job.status = shouldDefer ? "queued" : outcome;
  job.completedAt = shouldDefer ? null as any : now;
  if (shouldDefer) job.availableAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  job.leaseExpiresAt = null as any;
  job.failureCode = failureCode;
  job.resultSummary = resultSummary;
  job.pageUrlAtCompletion = normalizedPageUrl;
  await job.save();
  if (outcome === "skipped") {
    const relatedActionTypes = failureCode === "already_following"
      ? ["like_post", "like_story", "follow", "connect"]
      : failureCode === "follows_you" || failureCode === "prior_conversation" || failureCode === "prior_cove_dm"
        ? ["dm"]
        : [];
    if (relatedActionTypes.length) {
      await RecruitingCompanionJob.updateMany(
        {
          ownerEmail: companion.ownerEmail,
          companionId: companion._id,
          recipientLock: job.recipientLock,
          actionType: { $in: relatedActionTypes },
          status: "queued",
        },
        { $set: { status: "canceled", completedAt: now, failureCode, resultSummary } },
      );
    }
  }
  if (outcome === "failed" && !shouldDefer && ["like_post", "like_story", "follow", "connect"].includes(String(job.actionType))) {
    await RecruitingCompanionJob.updateMany(
      {
        ownerEmail: companion.ownerEmail,
        companionId: companion._id,
        recipientLock: job.recipientLock,
        sequence: { $gt: job.sequence },
        status: "queued",
      },
      { $set: { status: "canceled", completedAt: now, failureCode: "prerequisite_failed", resultSummary: "A required earlier step did not complete safely." } },
    );
  }
  if (outcome === "succeeded") {
    companion.lastActionAt = now;
    companion.lastRecipientLock = job.recipientLock;
    companion.lastSeenAt = now;
    await companion.save();
  }

  await RecruitingAuditEvent.updateOne(
    {
      ownerEmail: companion.ownerEmail,
      eventType: outcome === "succeeded" ? "action_completed" : outcome === "skipped" ? "action_skipped" : "action_failed",
      entityId: String(job._id),
    },
    {
      $setOnInsert: {
        ownerEmail: companion.ownerEmail,
        actorEmail: companion.ownerEmail,
        eventType: outcome === "succeeded" ? "action_completed" : outcome === "skipped" ? "action_skipped" : "action_failed",
        entityType: "companion_job",
        entityId: String(job._id),
        details: { companionId: String(companion._id), failureCode, resultSummary, normalizedPageUrl, deferred: shouldDefer },
      },
    },
    { upsert: true },
  );
  return res.status(200).json({ ok: true, status: job.status });
}
