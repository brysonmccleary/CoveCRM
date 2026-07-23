import { DateTime } from "luxon";
import { sendEmail } from "@/lib/email";
import mongooseConnect from "@/lib/mongooseConnect";
import { isWithinCompanionActiveHours, JOB_LEASE_MS, MIN_ACTION_INTERVAL_MS } from "@/lib/recruiting/companion/security";
import { normalizeProfileUrl } from "@/lib/recruiting/social/policy";
import type { SocialPlatform } from "@/lib/recruiting/social/types";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCloudAccount from "@/models/RecruitingCloudAccount";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";
import RecruitingDiscoveryJob from "@/models/RecruitingDiscoveryJob";
import RecruitingGrowthSnapshot from "@/models/RecruitingGrowthSnapshot";
import { captureOwnedAccountGrowth, discoverHostedCandidates, executeHostedAction } from "./automation";
import { withHostedPage, type BrowserbaseRegion } from "./browserbase";
import { completeHostedDiscovery } from "./discovery";
import { planDiscoverySource } from "./discovery-sources";

const ACCOUNT_LEASE_MS = 4 * 60 * 1000;
const FAILURE_CODES = new Set(["not_logged_in", "target_mismatch", "control_missing", "control_ambiguous", "content_unavailable", "unsupported_action", "execution_error", "already_following", "follows_you", "prior_conversation", "connection_pending"]);

async function markReauthenticationRequired(account: any) {
  const now = new Date();
  const shouldAlert = !account.lastAlertSentAt || now.getTime() - account.lastAlertSentAt.getTime() >= 24 * 60 * 60 * 1000;
  account.status = "reauth_required";
  account.lastCheckedAt = now;
  if (shouldAlert) {
    const name = account.platform === "linkedin" ? "LinkedIn" : "Instagram";
    const result = await sendEmail(
      account.ownerEmail,
      `${name} needs to be reconnected`,
      `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a"><h2>Reconnect ${name}</h2><p>CoveCRM stopped all ${name} activity because the saved login is no longer active.</p><p><a href="https://www.covecrm.com/recruiting">Reconnect securely in CoveCRM</a></p></div>`,
    );
    if (result.ok) account.lastAlertSentAt = now;
  }
  await account.save();
  await RecruitingAuditEvent.create({ ownerEmail: account.ownerEmail, actorEmail: account.ownerEmail, eventType: "cloud_account_reauth_required", entityType: "cloud_account", entityId: `${account._id}:${Date.now()}`, details: { platform: account.platform } });
}

function localStartOfDay(now: Date, timeZone: string): Date {
  const value = DateTime.fromJSDate(now).setZone(timeZone || "America/Phoenix").startOf("day").toUTC().toJSDate();
  return Number.isFinite(value.getTime()) ? value : new Date(new Date(now).setUTCHours(0, 0, 0, 0));
}

async function claimDiscovery(account: any, now: Date) {
  return RecruitingDiscoveryJob.findOneAndUpdate(
    { cloudAccountId: account._id, platform: account.platform, availableAt: { $lte: now }, $or: [{ status: "queued" }, { status: "claimed", leaseExpiresAt: { $lt: now } }] },
    { $set: { status: "claimed", claimedAt: now, leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS) }, $inc: { attempts: 1 } },
    { new: true, sort: { availableAt: 1 } },
  );
}

async function claimAction(account: any, now: Date) {
  const sinceLast = account.lastActionAt ? now.getTime() - account.lastActionAt.getTime() : Number.POSITIVE_INFINITY;
  const inCooldown = sinceLast < MIN_ACTION_INTERVAL_MS;
  const dmCount = await RecruitingCompanionJob.countDocuments({
    cloudAccountId: account._id,
    platform: account.platform,
    actionType: "dm",
    status: "succeeded",
    completedAt: { $gte: localStartOfDay(now, account.timeZone) },
  });
  return RecruitingCompanionJob.findOneAndUpdate(
    {
      cloudAccountId: account._id,
      platform: account.platform,
      availableAt: { $lte: now },
      ...(inCooldown ? { recipientLock: account.lastRecipientLock } : {}),
      ...(dmCount >= account.dailyDmLimit ? { actionType: { $ne: "dm" } } : {}),
      $or: [{ status: "queued" }, { status: "claimed", leaseExpiresAt: { $lt: now } }],
    },
    { $set: { status: "claimed", claimedAt: now, leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS) }, $inc: { attempts: 1 } },
    { new: true, sort: { createdAt: 1, sequence: 1 } },
  );
}

async function completeAction(account: any, job: any, rawResult: any) {
  const now = new Date();
  const outcome = rawResult.outcome === "succeeded" ? "succeeded" : rawResult.outcome === "skipped" ? "skipped" : "failed";
  const failureCode = outcome === "succeeded" ? "" : FAILURE_CODES.has(rawResult.failureCode) ? rawResult.failureCode : "execution_error";
  const normalizedPage = normalizeProfileUrl(job.platform, rawResult.pageUrl);
  if (normalizedPage !== job.targetSnapshot.profileUrl) throw new Error("Worker completion does not match the locked recipient.");
  const defer = outcome === "failed" && failureCode === "connection_pending" && job.attempts < 14;
  job.status = defer ? "queued" : outcome;
  job.completedAt = defer ? null : now;
  if (defer) job.availableAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  job.leaseExpiresAt = null;
  job.failureCode = failureCode;
  job.resultSummary = String(rawResult.resultSummary || "").slice(0, 500);
  job.pageUrlAtCompletion = normalizedPage;
  await job.save();
  if (outcome === "skipped") {
    const related = failureCode === "already_following" ? ["like_post", "like_story", "follow", "connect"]
      : ["follows_you", "prior_conversation"].includes(failureCode) ? ["dm"] : [];
    if (related.length) await RecruitingCompanionJob.updateMany(
      { cloudAccountId: account._id, recipientLock: job.recipientLock, actionType: { $in: related }, status: "queued" },
      { $set: { status: "canceled", completedAt: now, failureCode, resultSummary: job.resultSummary } },
    );
  }
  if (outcome === "failed" && !defer && ["like_post", "like_story", "follow", "connect"].includes(job.actionType)) {
    await RecruitingCompanionJob.updateMany(
      { cloudAccountId: account._id, recipientLock: job.recipientLock, sequence: { $gt: job.sequence }, status: "queued" },
      { $set: { status: "canceled", completedAt: now, failureCode: "prerequisite_failed", resultSummary: "A required earlier engagement step did not complete safely." } },
    );
  }
  if (outcome === "succeeded") {
    account.lastActionAt = now;
    account.lastRecipientLock = job.recipientLock;
    account.lastCheckedAt = now;
    await account.save();
  }
  const eventType = outcome === "succeeded" ? "action_completed" : outcome === "skipped" ? "action_skipped" : "action_failed";
  await RecruitingAuditEvent.updateOne(
    { ownerEmail: account.ownerEmail, eventType, entityId: String(job._id) },
    { $setOnInsert: { ownerEmail: account.ownerEmail, actorEmail: account.ownerEmail, eventType, entityType: "cloud_job", entityId: String(job._id), details: { hostedCloud: true, failureCode, resultSummary: job.resultSummary, deferred: defer } } },
    { upsert: true },
  );
  return { type: "action", outcome, failureCode, deferred: defer, jobId: String(job._id) };
}

async function processAccount(account: any) {
  const now = new Date();
  if (!isWithinCompanionActiveHours(now, account.timeZone || "America/Phoenix")) return { type: "quiet_hours", platform: account.platform };
  const ownerKey = String(account._id);
  const snapshotDue = account.profileUrl && (!account.lastGrowthSnapshotAt || now.getTime() - account.lastGrowthSnapshotAt.getTime() >= 20 * 60 * 60 * 1000);
  if (snapshotDue) {
    const metrics = await withHostedPage({ contextId: account.providerContextId, platform: account.platform, region: account.region as BrowserbaseRegion, ownerKey, task: (page) => captureOwnedAccountGrowth(page, account.platform as SocialPlatform, account.profileUrl) });
    if (metrics.loggedOut) { await markReauthenticationRequired(account); return { type: "reauth_required", platform: account.platform }; }
    account.lastGrowthSnapshotAt = now;
    account.lastCheckedAt = now;
    await account.save();
    if (metrics.followerCount !== null || metrics.connectionCount !== null) {
      const dayKey = DateTime.fromJSDate(now).setZone(account.timeZone || "America/Phoenix").toFormat("yyyy-LL-dd");
      await RecruitingGrowthSnapshot.updateOne({ cloudAccountId: account._id, dayKey }, { $set: { ownerEmail: account.ownerEmail, platform: account.platform, followerCount: metrics.followerCount, connectionCount: metrics.connectionCount, capturedAt: now }, $setOnInsert: { cloudAccountId: account._id, dayKey } }, { upsert: true });
    }
    return { type: "growth_snapshot", platform: account.platform };
  }
  const discovery = await claimDiscovery(account, now);
  if (discovery) {
    const searchQueries = Array.isArray(discovery.searchQueries) && discovery.searchQueries.length
      ? discovery.searchQueries
      : [discovery.searchQuery];
    const sourceCursor = Math.max(0, Number(discovery.sourceCursor || 0));
    const seedAccounts = Array.isArray(discovery.seedAccounts) ? discovery.seedAccounts.map(String) : [];
    const derivedSeedAccounts = Array.isArray(discovery.derivedSeedAccounts) ? discovery.derivedSeedAccounts.map(String) : [];
    const sourcePlan = planDiscoverySource(account.platform as SocialPlatform, searchQueries.map(String), seedAccounts, derivedSeedAccounts, sourceCursor);
    const activeSeedAccounts = sourcePlan.seedPool === "primary" ? seedAccounts
      : sourcePlan.seedPool === "derived" ? derivedSeedAccounts
      : [];
    const browserResult = await withHostedPage({
      contextId: account.providerContextId,
      platform: account.platform,
      region: account.region as BrowserbaseRegion,
      ownerKey,
      task: (page) => discoverHostedCandidates(page, account.platform as SocialPlatform, sourcePlan.activeQuery, discovery.maxCandidatesPerScan, {
        seedAccounts: activeSeedAccounts,
        sourceCursor: sourcePlan.seedSourceCursor,
      }),
    });
    account.lastCheckedAt = now;
    if (browserResult.loggedOut) {
      discovery.status = "queued";
      discovery.availableAt = new Date(now.getTime() + 60 * 60 * 1000);
      discovery.leaseExpiresAt = null as any;
      discovery.lastError = browserResult.error;
      await discovery.save();
      await markReauthenticationRequired(account);
      return { type: "reauth_required", platform: account.platform };
    }
    await account.save();
    return { type: "discovery", ...(await completeHostedDiscovery({ ownerEmail: account.ownerEmail, cloudAccountId: account._id, discovery, rawCandidates: browserResult.candidates, browserError: browserResult.error })) };
  }
  const firstJob = await claimAction(account, now);
  if (!firstJob) return { type: "idle", platform: account.platform };
  return withHostedPage({
    contextId: account.providerContextId,
    platform: account.platform,
    region: account.region as BrowserbaseRegion,
    ownerKey,
    task: async (page) => {
      const completed: any[] = [];
      let job: any = firstJob;
      for (let batchIndex = 0; batchIndex < 3 && job; batchIndex += 1) {
        const result = await executeHostedAction(page, { platform: job.platform as SocialPlatform, actionType: job.actionType as any, targetSnapshot: job.targetSnapshot as any, message: job.message });
        if (result.failureCode === "not_logged_in") {
          job.status = "queued";
          job.availableAt = new Date(Date.now() + 60 * 60 * 1000);
          job.leaseExpiresAt = null as any;
          await job.save();
          await markReauthenticationRequired(account);
          return { type: "reauth_required", platform: account.platform, completed };
        }
        completed.push(await completeAction(account, job, result));
        job = batchIndex < 2 ? await claimAction(account, new Date()) : null;
      }
      return { type: "action_batch", platform: account.platform, completed };
    },
  });
}

export async function processRecruitingCloudWork(limit = 10) {
  await mongooseConnect();
  const accounts: any[] = [];
  for (let index = 0; index < Math.min(25, Math.max(1, limit)); index += 1) {
    const now = new Date();
    const account = await RecruitingCloudAccount.findOneAndUpdate(
      { status: "active", $or: [{ workerLeaseExpiresAt: null }, { workerLeaseExpiresAt: { $lt: now } }] },
      { $set: { workerLeaseExpiresAt: new Date(now.getTime() + ACCOUNT_LEASE_MS) } },
      { new: true, sort: { lastActionAt: 1, updatedAt: 1 } },
    ).select("+providerContextId");
    if (!account) break;
    accounts.push(account);
  }
  const results = await Promise.all(accounts.map(async (account) => {
    try {
      return await processAccount(account);
    } catch {
      return { type: "error", platform: account.platform, error: "This account could not be processed right now." };
    } finally {
      await RecruitingCloudAccount.updateOne({ _id: account._id }, { $set: { workerLeaseExpiresAt: null } });
    }
  }));
  return { processed: results.length, results };
}
