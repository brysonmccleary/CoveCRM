import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { Types } from "mongoose";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";
import CampaignActionLog from "@/models/CampaignActionLog";

type ActionType = "PAUSE" | "SCALE" | "FIX" | "DUPLICATE_TEST";

function extractCopyId(payload: any, preferredKey: string): string {
  return String(
    payload?.[preferredKey] ||
      payload?.id ||
      payload?.copied_campaign_id ||
      payload?.copied_adset_id ||
      payload?.campaign_id ||
      payload?.adset_id ||
      payload?.data?.id ||
      payload?.data?.[preferredKey] ||
      ""
  ).trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const user = (await User.findOne({ email }).select("_id metaAccessToken").lean()) as any;
  if (!user?._id) return res.status(404).json({ error: "User not found" });

  if (req.method === "GET") {
    const campaignIdsRaw = String(req.query.campaignIds || "").trim();
    const campaignIds = campaignIdsRaw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => Types.ObjectId.isValid(id));

    if (campaignIds.length === 0) {
      return res.status(200).json({ latestActions: {} });
    }

    const logs = await CampaignActionLog.find({
      userId: user._id,
      campaignId: { $in: campaignIds.map((id) => new Types.ObjectId(id)) },
    })
      .sort({ createdAt: -1 })
      .lean();

    const latestActions: Record<string, { campaignId: string; actionType: string; createdAt: string }> = {};
    for (const log of logs as any[]) {
      const campaignId = String(log.campaignId || "");
      if (!campaignId || latestActions[campaignId]) continue;
      latestActions[campaignId] = {
        campaignId,
        actionType: String(log.actionType || ""),
        createdAt: new Date(log.createdAt).toISOString(),
      };
    }

    return res.status(200).json({ latestActions });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    campaignId,
    actionType,
    duplicateBudget,
    pauseOriginalAfterDuplicate,
    dryRun,
  } = req.body || {};

  if (!campaignId || !Types.ObjectId.isValid(campaignId)) {
    return res.status(400).json({ error: "Invalid campaignId" });
  }

  if (!["PAUSE", "SCALE", "FIX", "DUPLICATE_TEST"].includes(String(actionType))) {
    return res.status(400).json({ error: "Invalid actionType" });
  }

  const campaign = (await FBLeadCampaign.findOne({
    _id: new Types.ObjectId(campaignId),
    userId: user._id,
  }).lean()) as any;

  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" });
  }

  const accessToken = String(user.metaAccessToken || "").trim();
  if (!accessToken && !dryRun) {
    return res.status(400).json({ error: "Meta access token missing" });
  }

  const oldBudget = Number(campaign.dailyBudget || 0);
  let newBudget = oldBudget;
  const shouldPauseOriginal = pauseOriginalAfterDuplicate === true;
  const duplicateBudgetValue =
    typeof duplicateBudget === "number" && Number.isFinite(duplicateBudget)
      ? Number(duplicateBudget)
      : oldBudget;

  if (String(actionType) === "SCALE") {
    newBudget = Number((oldBudget * 1.2).toFixed(2));
  } else if (String(actionType) === "FIX" || String(actionType) === "DUPLICATE_TEST") {
    newBudget = Number(duplicateBudgetValue || oldBudget || 0);
  }

  if (dryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      actionType,
      campaignId,
      oldBudget,
      newBudget,
      pauseOriginalAfterDuplicate: shouldPauseOriginal,
    });
  }

  const metaResponse: Record<string, any> = {};

  if (String(actionType) === "PAUSE") {
    if (!campaign.metaCampaignId) {
      return res.status(400).json({ error: "Campaign is missing metaCampaignId" });
    }

    const params = new URLSearchParams();
    params.set("status", "PAUSED");
    params.set("access_token", accessToken);

    const resp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaCampaignId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = await resp.json();
    if (!resp.ok) {
      return res.status(500).json({ error: `Meta pause failed: ${JSON.stringify(json)}` });
    }
    metaResponse.pause = json;
  }

  if (String(actionType) === "SCALE") {
    if (!campaign.metaAdsetId) {
      return res.status(400).json({ error: "Campaign is missing metaAdsetId" });
    }

    const params = new URLSearchParams();
    params.set("daily_budget", String(Math.round(newBudget * 100)));
    params.set("access_token", accessToken);

    const resp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaAdsetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = await resp.json();
    if (!resp.ok) {
      return res.status(500).json({ error: `Meta scale failed: ${JSON.stringify(json)}` });
    }
    metaResponse.scale = json;
  }

  if (String(actionType) === "FIX") {
    if (!campaign.metaAdsetId) {
      return res.status(400).json({ error: "Campaign is missing metaAdsetId" });
    }

    const copyParams = new URLSearchParams();
    copyParams.set("access_token", accessToken);
    if (newBudget > 0) {
      copyParams.set("daily_budget", String(Math.round(newBudget * 100)));
    }

    const copyResp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaAdsetId}/copies`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: copyParams.toString(),
    });
    const copyJson = await copyResp.json();
    if (!copyResp.ok) {
      return res.status(500).json({ error: `Meta FIX duplicate failed: ${JSON.stringify(copyJson)}` });
    }
    metaResponse.fixCopy = copyJson;

    const copiedAdsetId = extractCopyId(copyJson, "copied_adset_id");
    if (!copiedAdsetId) {
      return res.status(500).json({ error: `Meta FIX duplicate failed: ${JSON.stringify(copyJson)}` });
    }

    if (newBudget > 0) {
      const budgetParams = new URLSearchParams();
      budgetParams.set("daily_budget", String(Math.round(newBudget * 100)));
      budgetParams.set("access_token", accessToken);
      const budgetResp = await fetch(`https://graph.facebook.com/v18.0/${copiedAdsetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: budgetParams.toString(),
      });
      const budgetJson = await budgetResp.json();
      if (!budgetResp.ok) {
        return res.status(500).json({ error: `Meta FIX budget update failed: ${JSON.stringify(budgetJson)}` });
      }
      metaResponse.fixBudget = budgetJson;
    }

    if (shouldPauseOriginal) {
      const pauseParams = new URLSearchParams();
      pauseParams.set("status", "PAUSED");
      pauseParams.set("access_token", accessToken);
      const pauseResp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaAdsetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: pauseParams.toString(),
      });
      const pauseJson = await pauseResp.json();
      if (!pauseResp.ok) {
        return res.status(500).json({ error: `Meta FIX pause original failed: ${JSON.stringify(pauseJson)}` });
      }
      metaResponse.fixPauseOriginal = pauseJson;
    }
  }

  if (String(actionType) === "DUPLICATE_TEST") {
    if (!campaign.metaCampaignId) {
      return res.status(400).json({ error: "Campaign is missing metaCampaignId" });
    }

    const copyParams = new URLSearchParams();
    copyParams.set("access_token", accessToken);
    if (newBudget > 0) {
      copyParams.set("daily_budget", String(Math.round(newBudget * 100)));
    }

    const copyResp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaCampaignId}/copies`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: copyParams.toString(),
    });
    const copyJson = await copyResp.json();
    if (!copyResp.ok) {
      return res.status(500).json({ error: `Meta campaign duplicate failed: ${JSON.stringify(copyJson)}` });
    }
    metaResponse.duplicateCampaign = copyJson;

    const copiedCampaignId = extractCopyId(copyJson, "copied_campaign_id");
    if (!copiedCampaignId) {
      return res.status(500).json({ error: `Meta campaign duplicate failed: ${JSON.stringify(copyJson)}` });
    }

    if (shouldPauseOriginal) {
      const pauseParams = new URLSearchParams();
      pauseParams.set("status", "PAUSED");
      pauseParams.set("access_token", accessToken);
      const pauseResp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaCampaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: pauseParams.toString(),
      });
      const pauseJson = await pauseResp.json();
      if (!pauseResp.ok) {
        return res.status(500).json({ error: `Meta duplicate pause original failed: ${JSON.stringify(pauseJson)}` });
      }
      metaResponse.duplicatePauseOriginal = pauseJson;
    }
  }

  const log = await CampaignActionLog.create({
    userId: user._id,
    campaignId: campaign._id,
    actionType: String(actionType) as ActionType,
    oldBudget,
    newBudget,
    metaResponse,
    createdAt: new Date(),
  });

  return res.status(200).json({
    ok: true,
    actionType,
    oldBudget,
    newBudget,
    metaResponse,
    log: {
      campaignId: String(log.campaignId),
      actionType: String(log.actionType),
      createdAt: new Date(log.createdAt).toISOString(),
    },
  });
}
