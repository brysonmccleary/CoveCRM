// pages/api/facebook/execute-action.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { Types } from "mongoose";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";
import CampaignActionLog from "@/models/CampaignActionLog";

type ActionType = "PAUSE" | "RESUME" | "SCALE" | "DECREASE" | "FIX" | "DUPLICATE_TEST" | "SET_BUDGET";

const ACTION_REASONING: Record<ActionType, string> = {
  SCALE: "CPL is below target and campaign is performing well.",
  FIX: "CPL is above target or lead quality needs improvement.",
  PAUSE: "Campaign is underperforming and should stop spending.",
  RESUME: "Campaign resumed to re-enable spend.",
  DECREASE: "Budget reduced to control costs.",
  DUPLICATE_TEST: "Campaign is strong enough to test a new variation.",
  SET_BUDGET: "Manual budget update by user.",
};

function getActionReasoning(actionType: ActionType, campaign: any): string {
  const candidate =
    String(campaign?.actionReasoning || campaign?.optimizationNotes || campaign?.lastActionReport || "").trim();
  if (candidate) return candidate;
  return ACTION_REASONING[actionType] || "";
}

const formatUsd = (value: number) => `$${Number(value || 0).toFixed(2)}`;

const MIN_GUARDRAIL_LEADS = 5;
const MIN_GUARDRAIL_SPEND = 50;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MIN_DAILY_BUDGET = 10;
const MAX_BUDGET_DELTA = 0.3;

type ActionMessageMode = "live" | "dryRun" | "mock";

function buildActionMessage(params: {
  actionType: ActionType;
  campaignName: string;
  oldBudget: number;
  newBudget: number;
  pauseOriginalAfterDuplicate: boolean;
  mode: ActionMessageMode;
}): string {
  const { actionType, campaignName, oldBudget, newBudget, pauseOriginalAfterDuplicate, mode } = params;
  const prefix = mode === "dryRun" ? "Dry run:" : mode === "mock" ? "Mock:" : "Success:";
  const passiveWould = mode === "dryRun" || mode === "mock";

  switch (actionType) {
    case "PAUSE":
      return `${prefix} ${passiveWould ? "Campaign would be paused" : "Paused campaign"} "${campaignName}" inside Meta.`;
    case "SCALE":
      return `${prefix} ${passiveWould ? "Budget would be increased" : "Increased budget"} from ${formatUsd(
        oldBudget
      )} → ${formatUsd(newBudget)} for "${campaignName}".`;
    case "FIX":
      return `${prefix} ${passiveWould ? "Targeting/creative adjustments would be applied" : "Duplicated ad set"} for "${
        campaignName
      }" at ${formatUsd(newBudget)}${pauseOriginalAfterDuplicate ? " and pause the original." : "."}`;
    case "DUPLICATE_TEST":
      return `${prefix} ${passiveWould ? "Campaign would be duplicated" : "Created duplicate campaign"} for "${
        campaignName
      }" at ${formatUsd(newBudget)}${pauseOriginalAfterDuplicate ? " and pause the original." : "."}`;
    case "SET_BUDGET":
      return `${prefix} ${passiveWould ? "Budget would be set manually" : "Budget updated"} from ${formatUsd(
        oldBudget
      )} → ${formatUsd(newBudget)} for "${campaignName}".`;
    case "RESUME":
      return `${prefix} ${passiveWould ? "Campaign would be resumed" : "Campaign resumed"} for "${campaignName}".`;
    case "DECREASE":
      return `${prefix} ${passiveWould ? "Budget would be decreased" : "Decreased budget"} from ${formatUsd(
        oldBudget
      )} → ${formatUsd(newBudget)} for "${campaignName}".`;
    default:
      return `${prefix} Action processed for "${campaignName}".`;
  }
}

function getGuardrailReason(
  campaign: any,
  params: { now: Date; oldBudget: number; newBudget?: number }
): string | null {
  const leads = Number(campaign?.totalLeads || 0);
  if (leads < MIN_GUARDRAIL_LEADS) {
    return "Minimum leads requirement (5) not met";
  }

  const spend = Number(campaign?.totalSpend || 0);
  if (spend < MIN_GUARDRAIL_SPEND) {
    return "Minimum spend requirement ($50) not met";
  }

  const createdAt = campaign?.createdAt ? new Date(campaign.createdAt) : null;
  if (createdAt && params.now.getTime() - createdAt.getTime() < THREE_DAYS_MS) {
    return "Campaign is less than 3 days old";
  }

  const lastAutomationAt = campaign?.lastAutomationActionAt ? new Date(campaign.lastAutomationActionAt) : null;
  if (lastAutomationAt && params.now.getTime() - lastAutomationAt.getTime() < TWENTY_FOUR_HOURS_MS) {
    return "Last automation action was within 24 hours";
  }

  const newBudget = typeof params.newBudget === "number" ? params.newBudget : params.oldBudget;
  const oldBudget = Number(params.oldBudget || 0);
  if (newBudget && oldBudget) {
    if (newBudget < MIN_DAILY_BUDGET) {
      return "Budget cannot go below $10";
    }
    const increasePct = newBudget > oldBudget ? (newBudget - oldBudget) / oldBudget : 0;
    if (increasePct > MAX_BUDGET_DELTA) {
      return "Budget increase exceeds 30% limit";
    }
    const decreasePct = newBudget < oldBudget ? (oldBudget - newBudget) / oldBudget : 0;
    if (decreasePct > MAX_BUDGET_DELTA) {
      return "Budget decrease exceeds 30% limit";
    }
  }

  return null;
}

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
  if (!isExperimentalAdminEmail(session?.user?.email)) return res.status(403).json({ error: 'Forbidden' });
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const metaMockMode = process.env.META_MOCK_MODE === "true";

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

  const { campaignId, actionType, duplicateBudget, pauseOriginalAfterDuplicate, dryRun, customBudget } = req.body || {};

  if (!campaignId || !Types.ObjectId.isValid(campaignId)) {
    return res.status(400).json({ error: "Invalid campaignId" });
  }

  if (!["PAUSE", "RESUME", "SCALE", "DECREASE", "FIX", "DUPLICATE_TEST", "SET_BUDGET"].includes(String(actionType))) {
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
  const isDryRun = dryRun === true;
  if (!accessToken && !isDryRun && !metaMockMode) {
    return res.status(400).json({ error: "Meta access token missing" });
  }

  const oldBudget = Number(campaign.dailyBudget || 0);
  let newBudget = oldBudget;
  const shouldPauseOriginal = pauseOriginalAfterDuplicate === true;
  const duplicateBudgetValue =
    typeof duplicateBudget === "number" && Number.isFinite(duplicateBudget)
      ? Number(duplicateBudget)
      : oldBudget;
  const customBudgetValue =
    typeof customBudget === "number" && Number.isFinite(customBudget)
      ? Number(customBudget)
      : Number(duplicateBudgetValue || oldBudget || 0);

  if (String(actionType) === "SCALE") {
    newBudget = Number((oldBudget * 1.2).toFixed(2));
  } else if (String(actionType) === "DECREASE") {
    newBudget = Number((oldBudget * 0.8).toFixed(2));
    const decreasePercent = oldBudget > 0 ? (oldBudget - newBudget) / oldBudget : 0;
    if (decreasePercent > 0.3) {
      return res.status(400).json({ error: "Cannot decrease more than 30% in a single action." });
    }
    if (newBudget < 10) {
      return res.status(400).json({ error: "Daily budget cannot go below $10." });
    }
  } else if (String(actionType) === "FIX" || String(actionType) === "DUPLICATE_TEST") {
    newBudget = Number(duplicateBudgetValue || oldBudget || 0);
  } else if (String(actionType) === "SET_BUDGET") {
    newBudget = Number(customBudgetValue || oldBudget || 0);
    if (!newBudget || newBudget <= 0) {
      return res.status(400).json({ error: "customBudget must be greater than 0" });
    }
  }
  let actionReasoning = getActionReasoning(actionType as ActionType, campaign);
  if (String(actionType) === "SET_BUDGET") {
    actionReasoning = ACTION_REASONING.SET_BUDGET;
  }

  const now = new Date();
  const metaResponse: Record<string, any> = {};
  const guardrailReason = getGuardrailReason(campaign, {
    now,
    oldBudget,
    newBudget,
  });

  if (guardrailReason) {
    const summaryInfo = {
      skipped: true,
      reason: `Guardrail: ${guardrailReason}`,
    };

    if (isDryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        actionType,
        campaignId,
        oldBudget,
        newBudget,
        skipped: true,
        message: summaryInfo.reason,
      });
    }

    const log = await CampaignActionLog.create({
      userId: user._id,
      campaignId: campaign._id,
      actionType: String(actionType) as ActionType,
      oldBudget,
      newBudget,
      metaResponse: { summary: summaryInfo },
      createdAt: now,
    });

    return res.status(200).json({
      ok: true,
      skipped: true,
      message: summaryInfo.reason,
      log: {
        campaignId: String(log.campaignId),
        actionType: String(log.actionType),
        createdAt: new Date(log.createdAt).toISOString(),
      },
    });
  }

  if (isDryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      actionType,
      campaignId,
      oldBudget,
      newBudget,
      pauseOriginalAfterDuplicate: shouldPauseOriginal,
      message: buildActionMessage({
        actionType: actionType as ActionType,
        campaignName: String(campaign.campaignName || "Campaign"),
        oldBudget,
        newBudget,
        pauseOriginalAfterDuplicate: shouldPauseOriginal,
        mode: "dryRun",
      }),
      reasoning: actionReasoning,
    });
  }
  const actionMessage = buildActionMessage({
    actionType: actionType as ActionType,
    campaignName: String(campaign.campaignName || "Campaign"),
    oldBudget,
    newBudget,
    pauseOriginalAfterDuplicate: shouldPauseOriginal,
    mode: metaMockMode ? "mock" : "live",
  });

  if (String(actionType) === "PAUSE") {
    if (!campaign.metaCampaignId) {
      return res.status(400).json({ error: "Campaign is missing metaCampaignId" });
    }

    if (metaMockMode) {
      metaResponse.pause = { mock: true, message: "Mock: Campaign would be paused." };
    } else {
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
  }

  if (String(actionType) === "DECREASE") {
    if (!campaign.metaAdsetId) {
      return res.status(400).json({ error: "Campaign is missing metaAdsetId" });
    }

    if (metaMockMode) {
      metaResponse.decrease = {
        mock: true,
        message: `Mock: Budget would be decreased from ${formatUsd(oldBudget)} → ${formatUsd(newBudget)}.`,
      };
    } else {
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
        return res.status(500).json({ error: `Meta decrease failed: ${JSON.stringify(json)}` });
      }
      metaResponse.decrease = json;
    }

    await FBLeadCampaign.updateOne(
      { _id: campaign._id },
      { $set: { dailyBudget: newBudget } }
    );
  }

  if (String(actionType) === "RESUME") {
    if (!campaign.metaCampaignId) {
      return res.status(400).json({ error: "Campaign is missing metaCampaignId" });
    }

    if (metaMockMode) {
      metaResponse.resume = { mock: true, message: "Mock: Campaign would be resumed." };
    } else {
      const params = new URLSearchParams();
      params.set("status", "ACTIVE");
      params.set("access_token", accessToken);

      const resp = await fetch(`https://graph.facebook.com/v18.0/${campaign.metaCampaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const json = await resp.json();
      if (!resp.ok) {
        return res.status(500).json({ error: `Meta resume failed: ${JSON.stringify(json)}` });
      }
      metaResponse.resume = json;
    }

    await FBLeadCampaign.updateOne(
      { _id: campaign._id },
      { $set: { status: "active", autoPaused: false } }
    );
  }

  if (String(actionType) === "SCALE") {
    if (!campaign.metaAdsetId) {
      return res.status(400).json({ error: "Campaign is missing metaAdsetId" });
    }

    if (metaMockMode) {
      metaResponse.scale = {
        mock: true,
        message: `Mock: Budget would be increased from ${formatUsd(oldBudget)} → ${formatUsd(newBudget)}.`,
      };
    } else {
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
  }
  if (String(actionType) === "SET_BUDGET") {
    if (!campaign.metaAdsetId) {
      return res.status(400).json({ error: "Campaign is missing metaAdsetId" });
    }

    if (metaMockMode) {
      metaResponse.setBudget = {
        mock: true,
        message: `Mock: Budget would be set from ${formatUsd(oldBudget)} → ${formatUsd(newBudget)}.`,
      };
    } else {
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
        return res.status(500).json({ error: `Meta set budget failed: ${JSON.stringify(json)}` });
      }
      metaResponse.setBudget = json;
    }

    await FBLeadCampaign.updateOne(
      { _id: campaign._id },
      { $set: { dailyBudget: newBudget } }
    );
  }

  if (String(actionType) === "FIX") {
    if (!campaign.metaAdsetId) {
      return res.status(400).json({ error: "Campaign is missing metaAdsetId" });
    }

    if (metaMockMode) {
      metaResponse.fix = {
        mock: true,
        message: `Mock: Targeting/creative adjustments would be applied at ${formatUsd(newBudget)}.`,
        pauseOriginalAfterDuplicate: shouldPauseOriginal,
      };
    } else {
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

    await FBLeadCampaign.updateOne(
      { _id: campaign._id },
      { $set: { creativeRefreshNeeded: false } }
    );
  }

  if (String(actionType) === "DUPLICATE_TEST") {
    if (!campaign.metaCampaignId) {
      return res.status(400).json({ error: "Campaign is missing metaCampaignId" });
    }

    if (metaMockMode) {
      metaResponse.duplicateCampaign = {
        mock: true,
        message: `Mock: Campaign would be duplicated with ${formatUsd(newBudget)} daily budget.`,
        pauseOriginalAfterDuplicate: shouldPauseOriginal,
      };
    } else {
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
  }

  const metaResponseWithSummary = {
    ...metaResponse,
    summary: {
      message: actionMessage,
      reasoning: actionReasoning,
      dryRun: false,
      mock: metaMockMode,
    },
  };

  const log = await CampaignActionLog.create({
    userId: user._id,
    campaignId: campaign._id,
    actionType: String(actionType) as ActionType,
    oldBudget,
    newBudget,
    metaResponse: metaResponseWithSummary,
    createdAt: new Date(),
  });

  return res.status(200).json({
    ok: true,
    dryRun: false,
    actionType,
    oldBudget,
    newBudget,
    metaResponse: metaResponseWithSummary,
    message: actionMessage,
    reasoning: actionReasoning,
    log: {
      campaignId: String(log.campaignId),
      actionType: String(log.actionType),
      createdAt: new Date(log.createdAt).toISOString(),
    },
  });
}
