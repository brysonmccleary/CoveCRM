import type { NextApiRequest, NextApiResponse } from "next";
import { authenticateCompanion } from "@/lib/recruiting/companion/auth";
import {
  COMPANION_CONSENT_VERSION,
  DEFAULT_COMPANION_TIME_ZONE,
  isWithinCompanionActiveHours,
  JOB_LEASE_MS,
  MIN_ACTION_INTERVAL_MS,
} from "@/lib/recruiting/companion/security";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";
import RecruitingPlatformSession from "@/models/RecruitingPlatformSession";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const companion = await authenticateCompanion(req);
  if (!companion) return res.status(401).json({ error: "Invalid companion token." });
  const now = new Date();
  companion.lastSeenAt = now;
  await companion.save();

  if (companion.paused) return res.status(200).json({ job: null, state: "paused", nextPollMs: 60_000 });
  if (companion.consentVersion !== COMPANION_CONSENT_VERSION || !companion.consentAcceptedAt) {
    return res.status(403).json({ error: "Companion consent must be renewed." });
  }
  if (!isWithinCompanionActiveHours(now, companion.timeZone || DEFAULT_COMPANION_TIME_ZONE)) {
    return res.status(200).json({ job: null, state: "quiet_hours", nextPollMs: 15 * 60_000 });
  }
  const millisecondsSinceLastAction = companion.lastActionAt
    ? now.getTime() - companion.lastActionAt.getTime()
    : Number.POSITIVE_INFINITY;
  const inCooldown = millisecondsSinceLastAction < MIN_ACTION_INTERVAL_MS;
  if (inCooldown && !companion.lastRecipientLock) {
    return res.status(200).json({ job: null, state: "rate_limited", nextPollMs: MIN_ACTION_INTERVAL_MS - millisecondsSinceLastAction });
  }

  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const loggedOutPlatforms = await RecruitingPlatformSession.find({
    companionId: companion._id,
    status: "logged_out",
  }).distinct("platform");
  const availablePlatforms = companion.allowedPlatforms.filter((platform) => !loggedOutPlatforms.includes(platform));
  if (!availablePlatforms.length) return res.status(200).json({ job: null, state: "login_required", nextPollMs: 15 * 60_000 });
  const dmCounts = await Promise.all(availablePlatforms.map(async (platform) => ({
    platform,
    count: await RecruitingCompanionJob.countDocuments({
      companionId: companion._id,
      platform,
      actionType: "dm",
      status: "succeeded",
      completedAt: { $gte: startOfDay },
    }),
  })));
  const cappedDmPlatforms = dmCounts
    .filter(({ count }) => count >= companion.dailyActionLimit)
    .map(({ platform }) => platform);

  const job = await RecruitingCompanionJob.findOneAndUpdate(
    {
      ownerEmail: companion.ownerEmail,
      companionId: companion._id,
      platform: { $in: availablePlatforms },
      availableAt: { $lte: now },
      ...(inCooldown ? { recipientLock: companion.lastRecipientLock } : {}),
      ...(cappedDmPlatforms.length ? {
        $nor: cappedDmPlatforms.map((platform) => ({ platform, actionType: "dm" })),
      } : {}),
      $or: [
        { status: "queued" },
        { status: "claimed", leaseExpiresAt: { $lt: now } },
      ],
    },
    {
      $set: {
        status: "claimed",
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { createdAt: 1, sequence: 1 } },
  ).lean() as any;
  if (!job) {
    return res.status(200).json({
      job: null,
      state: inCooldown ? "rate_limited" : cappedDmPlatforms.length === availablePlatforms.length ? "daily_dm_limit" : "idle",
      nextPollMs: inCooldown ? MIN_ACTION_INTERVAL_MS - millisecondsSinceLastAction : cappedDmPlatforms.length ? 15 * 60_000 : 60_000,
    });
  }

  await RecruitingAuditEvent.updateOne(
    { ownerEmail: companion.ownerEmail, eventType: "action_claimed", entityId: String(job._id) },
    {
      $setOnInsert: {
        ownerEmail: companion.ownerEmail,
        actorEmail: companion.ownerEmail,
        eventType: "action_claimed",
        entityType: "companion_job",
        entityId: String(job._id),
        details: { companionId: String(companion._id), attempt: job.attempts },
      },
    },
    { upsert: true },
  );
  return res.status(200).json({
    state: "claimed",
    job: {
      id: job._id,
      platform: job.platform,
      actionType: job.actionType,
      targetSnapshot: job.targetSnapshot,
      recipientLock: job.recipientLock,
      message: job.message,
      leaseExpiresAt: job.leaseExpiresAt,
    },
  });
}
