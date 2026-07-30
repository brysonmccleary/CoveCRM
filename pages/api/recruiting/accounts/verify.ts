import type { NextApiRequest, NextApiResponse } from "next";
import { Types } from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import { releaseHostedSession, verifyLoginSessionDetails } from "@/lib/recruiting/cloud/browserbase";
import { RECRUITING_PUBLIC_MESSAGES } from "@/lib/recruiting/public-errors";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCloudAccount from "@/models/RecruitingCloudAccount";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;
  const accountId = String(req.body?.accountId || "");
  if (!Types.ObjectId.isValid(accountId)) return res.status(400).json({ error: "Connected account is invalid." });
  try {
    await mongooseConnect();
    const account = await RecruitingCloudAccount.findOne({ _id: accountId, ownerEmail: admin.email, status: "connecting" })
      .select("+loginSessionId");
    if (!account?.loginSessionId) return res.status(404).json({ code: "ACCOUNT_LOGIN_EXPIRED", error: RECRUITING_PUBLIC_MESSAGES.ACCOUNT_LOGIN_EXPIRED });
    const verification = await verifyLoginSessionDetails(account.loginSessionId, account.platform as any);
    if (!verification.authenticated) return res.status(409).json({ code: "ACCOUNT_LOGIN_NOT_FINISHED", error: RECRUITING_PUBLIC_MESSAGES.ACCOUNT_LOGIN_NOT_FINISHED });
    if (!verification.languageSupported) return res.status(409).json({ code: "ACCOUNT_LANGUAGE_UNSUPPORTED", error: RECRUITING_PUBLIC_MESSAGES.ACCOUNT_LANGUAGE_UNSUPPORTED });
    await releaseHostedSession(account.loginSessionId).catch(() => undefined);
    account.status = "active";
    account.lastAuthenticatedAt = new Date();
    account.lastCheckedAt = new Date();
    if (verification.profileUrl) account.profileUrl = verification.profileUrl;
    account.loginSessionId = null as any;
    await account.save();
    await RecruitingAuditEvent.create({
      ownerEmail: admin.email,
      actorEmail: admin.email,
      eventType: "cloud_account_connected",
      entityType: "cloud_account",
      entityId: `${account._id}:${Date.now()}`,
      details: { platform: account.platform },
    });
    return res.status(200).json({ ok: true, platform: account.platform, status: account.status });
  } catch {
    return res.status(502).json({ code: "ACCOUNT_VERIFY_FAILED", error: RECRUITING_PUBLIC_MESSAGES.ACCOUNT_VERIFY_FAILED });
  }
}
