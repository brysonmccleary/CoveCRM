// /pages/api/cron/a2p-sync-all.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { resumeA2PAutomationForUserEmail } from "@/lib/a2p/resumeAutomation";

const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

const REJECTED_STATUSES = new Set(["rejected", "declined"]);

function log(...args: any[]) {
  console.log("[CRON a2p-sync-all]", ...args);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const provided =
    (Array.isArray(req.headers["x-cron-secret"])
      ? req.headers["x-cron-secret"][0]
      : (req.headers["x-cron-secret"] as string | undefined)) ||
    (Array.isArray(req.headers["x-cron-key"])
      ? req.headers["x-cron-key"][0]
      : (req.headers["x-cron-key"] as string | undefined)) ||
    (typeof req.query.token === "string" ? req.query.token : undefined) ||
    (typeof req.query.secret === "string" ? req.query.secret : undefined);

  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(403).json({ message: "Forbidden" });
  }

  await mongooseConnect();

  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50) || 50));
  const profiles = await A2PProfile.find({
    $or: [
      { messagingReady: { $ne: true } },
      { applicationStatus: { $in: [null, "pending"] } },
      { registrationStatus: { $in: ["profile_submitted", "trust_product_submitted", "brand_submitted", "brand_approved", "campaign_submitted"] } },
    ],
  })
    .sort({ lastCheckedAt: 1, updatedAt: 1 })
    .limit(limit)
    .lean<any[]>();

  const results: any[] = [];

  for (const profile of profiles) {
    const userId = String(profile.userId || "");
    const registrationStatus = String(profile.registrationStatus || "").toLowerCase();
    const applicationStatus = String(profile.applicationStatus || "").toLowerCase();

    if (REJECTED_STATUSES.has(registrationStatus) || REJECTED_STATUSES.has(applicationStatus)) {
      results.push({
        userId,
        action: "wouldWait",
        reason: "rejected_or_declined_requires_explicit_same_campaign_resubmission",
      });
      continue;
    }

    const user = userId ? await User.findById(userId).lean<{ email?: string } | null>() : null;
    const email = String(user?.email || profile.userEmail || "").toLowerCase().trim();
    if (!email) {
      results.push({ userId, action: "wouldWait", reason: "missing_user_email" });
      continue;
    }

    try {
      const before = {
        trustProductSid: profile.trustProductSid || null,
        brandSid: profile.brandSid || null,
        campaignSid: profile.campaignSid || profile.usa2pSid || null,
        messagingReady: Boolean(profile.messagingReady),
      };
      const updated = await resumeA2PAutomationForUserEmail(email);
      const after = {
        trustProductSid: updated?.trustProductSid || null,
        brandSid: updated?.brandSid || null,
        campaignSid: updated?.campaignSid || updated?.usa2pSid || null,
        messagingReady: Boolean(updated?.messagingReady),
        registrationStatus: updated?.registrationStatus || null,
        applicationStatus: updated?.applicationStatus || null,
      };

      let action = "wouldFetch";
      if (!before.trustProductSid && after.trustProductSid) action = "wouldCreateTrustProduct";
      else if (!before.brandSid && after.brandSid) action = "wouldCreateBrand";
      else if (!before.campaignSid && after.campaignSid) action = "wouldCreateCampaign";
      else if (!before.messagingReady && after.messagingReady) action = "wouldMarkReady";
      else if (before.campaignSid && after.campaignSid === before.campaignSid) action = "wouldFetchOrUpdateCampaign";

      results.push({ userId, email, action, before, after });
      log("processed", { userId, email, action });
    } catch (err: any) {
      results.push({
        userId,
        email,
        action: "wouldWait",
        reason: err?.message || String(err),
      });
      log("error", { userId, email, message: err?.message || String(err) });
    }
  }

  return res.status(200).json({
    ok: true,
    total: profiles.length,
    results,
  });
}
