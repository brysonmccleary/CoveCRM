import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";
import CampaignActionLog from "@/models/CampaignActionLog";

type Summary = {
  scaled: number;
  paused: number;
  fixed: number;
  duplicated: number;
};

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  if (req.method === "POST") {
    const { campaignId, automationEnabled } = req.body || {};
    if (!campaignId) {
      return res.status(400).json({ error: "campaignId is required" });
    }

    const campaign = await FBLeadCampaign.findByIdAndUpdate(
      campaignId,
      { $set: { automationEnabled: !!automationEnabled } },
      { new: true }
    ).lean() as any;

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    return res.status(200).json({
      ok: true,
      campaignId: String(campaign._id),
      automationEnabled: !!campaign.automationEnabled,
    });
  }

  const now = new Date();
  const summary: Summary = {
    scaled: 0,
    paused: 0,
    fixed: 0,
    duplicated: 0,
  };

  const campaigns = await FBLeadCampaign.find({
    automationEnabled: true,
    metaCampaignId: { $exists: true, $ne: "" },
    metaAdsetId: { $exists: true, $ne: "" },
  }).lean();

  for (const campaign of campaigns as any[]) {
    const lastActionAt = campaign.lastAutomationActionAt ? new Date(campaign.lastAutomationActionAt) : null;
    if (lastActionAt && now.getTime() - lastActionAt.getTime() < FORTY_EIGHT_HOURS_MS) {
      continue;
    }

    const createdAt = campaign.createdAt ? new Date(campaign.createdAt) : null;
    if (
      campaign.performanceClass === "PAUSE" &&
      createdAt &&
      now.getTime() - createdAt.getTime() < THREE_DAYS_MS
    ) {
      continue;
    }

    const dailyBudget = Number(campaign.dailyBudget || 0);
    const spend = Number(campaign.totalSpend || 0);
    const leads = Number(campaign.totalLeads || 0);
    const targetCpl = Number(campaign.targetCpl || 0);
    const cpl = Number(campaign.cpl || 0);

    if (!targetCpl || targetCpl <= 0) continue;

    let actionType: "SCALE" | "PAUSE" | "FIX" | "DUPLICATE_TEST" | null = null;
    let newBudget = dailyBudget;
    let pauseOriginalAfterDuplicate = false;

    if (
      campaign.performanceClass === "SCALE" &&
      cpl < targetCpl &&
      spend > 2 * targetCpl &&
      dailyBudget <= 200
    ) {
      actionType = "SCALE";
      newBudget = Number((dailyBudget * 1.2).toFixed(2));
    }

    if (
      campaign.performanceClass === "PAUSE" &&
      cpl > 2 * targetCpl &&
      spend > targetCpl
    ) {
      actionType = "PAUSE";
      newBudget = dailyBudget;
    }

    if (
      campaign.performanceClass === "FIX" &&
      cpl > targetCpl &&
      leads < 3 &&
      spend > targetCpl &&
      dailyBudget >= 10
    ) {
      actionType = "FIX";
      newBudget = dailyBudget;
      pauseOriginalAfterDuplicate = false;
    }

    if (
      campaign.performanceClass === "DUPLICATE_TEST" &&
      cpl < targetCpl &&
      leads >= 3 &&
      spend > 2 * targetCpl &&
      dailyBudget >= 10
    ) {
      actionType = "DUPLICATE_TEST";
      newBudget = dailyBudget;
      pauseOriginalAfterDuplicate = false;
    }

    if (!actionType) continue;

    const user = await User.findById(campaign.userId).select("metaAccessToken").lean() as any;
    const accessToken = String(user?.metaAccessToken || "").trim();
    if (!accessToken) continue;

    const metaResponse: Record<string, any> = {};

    try {
      if (actionType === "PAUSE") {
        const params = new URLSearchParams();
        params.set("status", "PAUSED");
        params.set("access_token", accessToken);

        const resp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaCampaignId}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(JSON.stringify(json));
        metaResponse.pause = json;
        summary.paused += 1;
      }

      if (actionType === "SCALE") {
        const params = new URLSearchParams();
        params.set("daily_budget", String(Math.round(newBudget * 100)));
        params.set("access_token", accessToken);

        const resp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaAdsetId}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(JSON.stringify(json));
        metaResponse.scale = json;
        summary.scaled += 1;
      }

      if (actionType === "FIX") {
        const copyParams = new URLSearchParams();
        copyParams.set("access_token", accessToken);
        copyParams.set("daily_budget", String(Math.round(newBudget * 100)));

        const copyResp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaAdsetId}/copies`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: copyParams.toString(),
        });
        const copyJson = await copyResp.json();
        if (!copyResp.ok) throw new Error(JSON.stringify(copyJson));
        metaResponse.fix = copyJson;

        if (pauseOriginalAfterDuplicate) {
          const pauseParams = new URLSearchParams();
          pauseParams.set("status", "PAUSED");
          pauseParams.set("access_token", accessToken);
          await fetch(`https://graph.facebook.com/v18.0/${campaign.metaAdsetId}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: pauseParams.toString(),
          });
        }
        summary.fixed += 1;
      }

      if (actionType === "DUPLICATE_TEST") {
        const copyParams = new URLSearchParams();
        copyParams.set("access_token", accessToken);
        copyParams.set("daily_budget", String(Math.round(newBudget * 100)));

        const copyResp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaCampaignId}/copies`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: copyParams.toString(),
        });
        const copyJson = await copyResp.json();
        if (!copyResp.ok) throw new Error(JSON.stringify(copyJson));
        metaResponse.duplicate = copyJson;

        if (pauseOriginalAfterDuplicate) {
          const pauseParams = new URLSearchParams();
          pauseParams.set("status", "PAUSED");
          pauseParams.set("access_token", accessToken);
          await fetch(`https://graph.facebook.com/v18.0/${campaign.metaCampaignId}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: pauseParams.toString(),
          });
        }
        summary.duplicated += 1;
      }

      await CampaignActionLog.create({
        userId: campaign.userId,
        campaignId: campaign._id,
        actionType,
        oldBudget: dailyBudget,
        newBudget,
        metaResponse,
        createdAt: now,
      });

      await FBLeadCampaign.updateOne(
        { _id: campaign._id },
        { $set: { lastAutomationActionAt: now } }
      );
    } catch (err) {
      console.error("[facebook/auto-optimize] action failed", {
        campaignId: String(campaign._id),
        actionType,
        error: err,
      });
    }
  }

  return res.status(200).json(summary);
}
