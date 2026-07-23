import type { NextApiRequest, NextApiResponse } from "next";
import { Types } from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import { deleteHostedContext, releaseHostedSession } from "@/lib/recruiting/cloud/browserbase";
import { sanitizeHostedAccount, transitionHostedAccount } from "@/lib/recruiting/cloud/lifecycle";
import { RecruitingPublicError, recruitingErrorPayload, RECRUITING_PUBLIC_MESSAGES } from "@/lib/recruiting/public-errors";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCampaign from "@/models/RecruitingCampaign";
import RecruitingCloudAccount from "@/models/RecruitingCloudAccount";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";
import RecruitingDiscoveryJob from "@/models/RecruitingDiscoveryJob";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method === "GET") {
    try {
      await mongooseConnect();
      const accounts = await RecruitingCloudAccount.find({ ownerEmail: admin.email, status: { $ne: "canceled" } })
        .sort({ platform: 1, createdAt: -1 })
        .lean();
      return res.status(200).json({ accounts: accounts.map((account) => sanitizeHostedAccount(account as any)) });
    } catch {
      return res.status(503).json({ code: "ACCOUNT_LOAD_FAILED", error: RECRUITING_PUBLIC_MESSAGES.ACCOUNT_LOAD_FAILED });
    }
  }

  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });
  const accountId = String(req.body?.accountId || "");
  const operation = String(req.body?.operation || "");
  if (!Types.ObjectId.isValid(accountId) || !["pause", "resume", "cancel"].includes(operation)) {
    return res.status(400).json({ error: "A valid account and operation are required." });
  }
  try {
    await mongooseConnect();
    const account = await RecruitingCloudAccount.findOne({ _id: accountId, ownerEmail: admin.email })
      .select("+providerContextId +loginSessionId");
    if (!account) throw new RecruitingPublicError("ACCOUNT_UPDATE_FAILED", "That connected account is no longer available.");
    const nextStatus = transitionHostedAccount(account.status as any, operation as any);
    if (operation === "cancel") {
      if (account.loginSessionId) await releaseHostedSession(account.loginSessionId).catch(() => undefined);
      await deleteHostedContext(account.providerContextId);
      const now = new Date();
      account.status = nextStatus as any;
      account.canceledAt = now;
      account.loginSessionId = null as any;
      await Promise.all([
        account.save(),
        RecruitingCampaign.updateMany({ ownerEmail: admin.email, platforms: account.platform, status: "active" }, { $set: { status: "paused" } }),
        RecruitingDiscoveryJob.updateMany({ cloudAccountId: account._id }, { $set: { status: "paused" }, $unset: { leaseExpiresAt: 1 } }),
        RecruitingCompanionJob.updateMany(
          { cloudAccountId: account._id, status: { $in: ["queued", "claimed"] } },
          { $set: { status: "canceled", completedAt: now, failureCode: "account_canceled", resultSummary: "Connected account was canceled by its owner." }, $unset: { leaseExpiresAt: 1 } },
        ),
      ]);
    } else {
      account.status = nextStatus as any;
      await account.save();
    }
    await RecruitingAuditEvent.create({
      ownerEmail: admin.email,
      actorEmail: admin.email,
      eventType: operation === "pause" ? "cloud_account_paused" : operation === "resume" ? "cloud_account_resumed" : "cloud_account_canceled",
      entityType: "cloud_account",
      entityId: `${account._id}:${Date.now()}`,
      details: { platform: account.platform },
    });
    return res.status(200).json({ account: sanitizeHostedAccount(account.toObject() as any) });
  } catch (error) {
    return res.status(409).json(recruitingErrorPayload(error, "ACCOUNT_UPDATE_FAILED"));
  }
}
