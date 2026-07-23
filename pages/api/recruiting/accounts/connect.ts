import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import {
  createHostedContext,
  hostedBrowserIsConfigured,
  releaseHostedSession,
  startLoginSession,
  type BrowserbaseRegion,
} from "@/lib/recruiting/cloud/browserbase";
import { HOSTED_SOCIAL_CONSENT_VERSION } from "@/lib/recruiting/cloud/lifecycle";
import { RECRUITING_PUBLIC_MESSAGES } from "@/lib/recruiting/public-errors";
import { isValidTimeZone } from "@/lib/recruiting/companion/security";
import type { SocialPlatform } from "@/lib/recruiting/social/types";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCloudAccount from "@/models/RecruitingCloudAccount";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;
  if (!hostedBrowserIsConfigured()) {
    return res.status(503).json({
      code: "ACCOUNT_CONNECTION_UNAVAILABLE",
      error: RECRUITING_PUBLIC_MESSAGES.ACCOUNT_CONNECTION_UNAVAILABLE,
    });
  }
  if (req.body?.consentAccepted !== true || req.body?.consentVersion !== HOSTED_SOCIAL_CONSENT_VERSION) {
    return res.status(400).json({ error: "Accept the current CoveCRM account-access agreement first." });
  }
  const platform = req.body?.platform === "instagram" || req.body?.platform === "linkedin"
    ? req.body.platform as SocialPlatform
    : null;
  if (!platform) return res.status(400).json({ error: "Choose Instagram or LinkedIn." });
  const timeZone = isValidTimeZone(String(req.body?.timeZone || "")) ? String(req.body.timeZone) : "America/Phoenix";
  const region: BrowserbaseRegion = /^(America\/New_York|America\/Detroit|America\/Indiana)/.test(timeZone) ? "us-east-1" : "us-west-2";

  try {
    await mongooseConnect();
    let account = await RecruitingCloudAccount.findOne({ ownerEmail: admin.email, platform, status: { $ne: "canceled" } })
      .select("+providerContextId +loginSessionId");
    if (!account) {
      const providerContextId = await createHostedContext();
      account = await RecruitingCloudAccount.create({
        ownerEmail: admin.email,
        platform,
        providerContextId,
        status: "connecting",
        consentVersion: HOSTED_SOCIAL_CONSENT_VERSION,
        consentAcceptedAt: new Date(),
        region,
        timeZone,
      });
    } else {
      if (account.loginSessionId) await releaseHostedSession(account.loginSessionId).catch(() => undefined);
      account.status = "connecting";
      account.timeZone = timeZone;
    }
    const ownerKey = createHash("sha256").update(admin.email).digest("hex").slice(0, 16);
    const login = await startLoginSession({ contextId: account.providerContextId, platform, region: account.region as BrowserbaseRegion, ownerKey });
    account.loginSessionId = login.sessionId;
    await account.save();
    await RecruitingAuditEvent.create({
      ownerEmail: admin.email,
      actorEmail: admin.email,
      eventType: "cloud_account_connecting",
      entityType: "cloud_account",
      entityId: `${account._id}:${Date.now()}`,
      details: { platform, region: account.region, consentVersion: HOSTED_SOCIAL_CONSENT_VERSION },
    });
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(201).json({ accountId: account._id, platform, liveViewUrl: login.liveViewUrl, expiresAt: login.expiresAt });
  } catch {
    return res.status(502).json({
      code: "ACCOUNT_CONNECTION_UNAVAILABLE",
      error: RECRUITING_PUBLIC_MESSAGES.ACCOUNT_CONNECTION_UNAVAILABLE,
    });
  }
}
