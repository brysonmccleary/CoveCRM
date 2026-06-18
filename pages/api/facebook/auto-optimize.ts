// pages/api/facebook/auto-optimize.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";
import CampaignActionLog from "@/models/CampaignActionLog";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import { sendEmail } from "@/lib/email";
import { checkMetaWriteReadiness, markMetaHealthFailure } from "@/lib/meta/metaHealth";

type Summary = {
  processed: number;
  scaled: number;
  paused: number;
  fixed: number;
  duplicated: number;
  decreased: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  totalDailyBudget: number;
  accountBudgetCap: number;
  capReached: boolean;
  reallocationMovesProposed: number;
  reallocationMovesApplied: number;
  fatiguedCampaigns: number;
};

type ReallocationEntry = {
  fromCampaignId: string;
  toCampaignId: string;
  amount: number;
};

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MIN_GUARDRAIL_LEADS = 5;
const MIN_GUARDRAIL_SPEND = 50;
const MIN_DAILY_BUDGET = 10;
const MAX_BUDGET_DELTA = 0.3;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const SKIP_CODES = {
  NO_AUTOMATION: "automationDisabled",
  COOLDOWN: "cooldown",
  GUARDRAIL_PAUSE: "pauseGuardrail",
  MISSING_TARGET: "missingTargetCpl",
  LEAD_MIN: "leadMinimum",
  SPEND_MIN: "spendMinimum",
  NO_ACCESS: "missingAccessToken",
  META_HEALTH: "metaHealthBlocked",
  NO_ACTION: "noAction",
  GUARDRAIL: "guardrail",
} as const;

type SkipCode = (typeof SKIP_CODES)[keyof typeof SKIP_CODES];

const recordSkip = (summary: Summary, code: SkipCode) => {
  summary.skipped += 1;
  summary.skippedReasons[code] = (summary.skippedReasons[code] || 0) + 1;
};

const getPerformanceValue = (campaign: any): number => {
  const score = Number(campaign?.performanceScore ?? 0);
  return Number.isFinite(score) ? score : 0;
};

type UserBudgetState = {
  totalBudget: number;
  cap: number;
};

const buildUserBudgetState = (campaigns: any[]): Map<string, UserBudgetState> => {
  const map = new Map<string, UserBudgetState>();
  for (const campaign of campaigns) {
    const key = String(campaign.userId);
    const entry = map.get(key) || { totalBudget: 0, cap: 0 };
    entry.totalBudget += Number(campaign.dailyBudget || 0);
    if (!entry.cap) {
      const capValue = Number(campaign.accountBudgetCap || 0);
      if (capValue > 0) entry.cap = capValue;
    }
    map.set(key, entry);
  }
  return map;
};

type OutcomeMetrics = {
  appointments: number;
  answered: number;
  notInterested: number;
  noResponse: number;
  sales: number;
  totalLeads: number;
};

function getOutcomeMetrics(campaign: any): OutcomeMetrics {
  const stats =
    (campaign?.leadOutcomeStats as Record<string, any>) ||
    (campaign?.outcomeStats as Record<string, any>) ||
    {};
  const appointments =
    Number(
      stats.bookedAppointments ??
        stats.booked ??
        stats.appointments ??
        stats.scheduled ??
        0
    ) || 0;
  const answered = Number(stats.answered ?? stats.answer ?? stats.contacts ?? 0) || 0;
  const notInterested = Number(stats.notInterested ?? stats.disqualified ?? 0) || 0;
  const noResponse = Number(stats.noResponse ?? stats.unreached ?? 0) || 0;
  const sales = Number(stats.sales ?? stats.closed ?? stats.wins ?? 0) || 0;
  const totalLeads =
    Number(campaign?.totalLeads ?? 0) ||
    appointments + answered + notInterested + noResponse;
  return {
    appointments,
    answered,
    notInterested,
    noResponse,
    sales,
    totalLeads,
  };
}

function calculateLeadQualityScore(
  campaign: any,
  metrics?: OutcomeMetrics
): number {
  const { appointments, answered, notInterested, noResponse, totalLeads } =
    metrics || getOutcomeMetrics(campaign);

  if (!totalLeads) return 0;
  const score =
    appointments * 5 + answered * 2 - notInterested * 2 - noResponse * 1;
  return Number((score / totalLeads).toFixed(2));
}

function calculatePerformanceScore(params: {
  targetCpl: number;
  actualCpl: number;
  leadQualityScore: number;
  appointmentTarget: number;
  costPerAppointment: number;
  closeRate: number;
}): number {
  const cplScore =
    params.targetCpl > 0 && params.actualCpl > 0
      ? (params.targetCpl / params.actualCpl) * 100
      : 0;
  const appointmentScore =
    params.appointmentTarget > 0 && params.costPerAppointment > 0
      ? (params.appointmentTarget / params.costPerAppointment) * 100
      : 0;
  const leadQualityComponent = Math.max(params.leadQualityScore * 20, 0);
  const closeRateScore = Math.max(params.closeRate * 100, 0);
  const rawScore =
    cplScore * 0.3 +
    leadQualityComponent * 0.2 +
    appointmentScore * 0.3 +
    closeRateScore * 0.2;
  const capped = Math.max(0, Math.min(150, rawScore));
  return Number(capped.toFixed(2));
}

function detectCreativeFatigue(campaign: any): boolean {
  const currentCpl = Number(campaign?.cpl ?? 0);
  const prevAvgCpl = Number(
    campaign?.previousAvgCpl ?? campaign?.avgCpl ?? currentCpl
  );
  const currentCtr = Number(campaign?.ctr ?? campaign?.currentCtr ?? 0);
  const prevAvgCtr = Number(
    campaign?.previousAvgCtr ?? campaign?.avgCtr ?? currentCtr
  );
  const frequencyHigh = Number(campaign?.frequency ?? 0) > 2.5;

  const weeklyLeads: number[] = Array.isArray(campaign?.weeklyLeads)
    ? (campaign.weeklyLeads as number[])
    : [];
  const inferredThisWeek =
    Number(campaign?.leadsThisWeek ?? campaign?.currentWeekLeads ?? 0) ||
    (weeklyLeads.length ? Number(weeklyLeads[weeklyLeads.length - 1] ?? 0) : 0);
  const inferredLastWeek =
    Number(campaign?.leadsLastWeek ?? campaign?.previousWeekLeads ?? 0) ||
    (weeklyLeads.length > 1 ? Number(weeklyLeads[weeklyLeads.length - 2] ?? 0) : 0);

  const cplSpike = prevAvgCpl > 0 && currentCpl > prevAvgCpl * 1.3;
  const ctrDrop =
    prevAvgCtr > 0 && currentCtr > 0 && currentCtr < prevAvgCtr * 0.75;
  const leadDrop =
    inferredLastWeek > 0 && inferredThisWeek < inferredLastWeek;

  return cplSpike || ctrDrop || frequencyHigh || leadDrop;
}

function getGuardrailReason(
  campaign: any,
  params: { now: Date; oldBudget: number; newBudget: number }
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

  const oldBudget = Number(params.oldBudget || 0);
  const newBudget = Number(params.newBudget || oldBudget);
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

function buildReallocationPlan(campaigns: any[]): ReallocationEntry[] {
  const donors = campaigns
    .filter(
      (c: any) =>
        (getPerformanceValue(c) > 0
          ? getPerformanceValue(c) < 65
          : Number(c.cpl || 0) > Number(c.targetCpl || 0)) &&
        Number(c.totalSpend || 0) >= MIN_GUARDRAIL_SPEND &&
        Number(c.dailyBudget || 0) > MIN_DAILY_BUDGET
    )
    .map((c: any) => {
      const budget = Number(c.dailyBudget || 0);
      const available = Math.min(budget * 0.2, budget - MIN_DAILY_BUDGET);
      return {
        campaign: c,
        available: Number(available.toFixed(2)),
      };
    })
    .filter((entry) => entry.available > 1)
    .sort((a, b) => getPerformanceValue(a.campaign) - getPerformanceValue(b.campaign));

  const winners = campaigns
    .filter(
      (c: any) =>
        (getPerformanceValue(c) > 0
          ? getPerformanceValue(c) >= 80
          : Number(c.cpl || 0) > 0 &&
            Number(c.targetCpl || 0) > 0 &&
            Number(c.cpl || 0) < Number(c.targetCpl || 0)) &&
        Number(c.totalLeads || 0) >= MIN_GUARDRAIL_LEADS
    )
    .map((c: any) => {
      const budget = Number(c.dailyBudget || 0);
      const capacity = Math.min(budget * 0.2, budget * MAX_BUDGET_DELTA);
      return {
        campaign: c,
        capacity: Number(capacity.toFixed(2)),
      };
    })
    .filter((entry) => entry.capacity > 1)
    .sort((a, b) => getPerformanceValue(b.campaign) - getPerformanceValue(a.campaign));

  const plan: ReallocationEntry[] = [];
  let donorIndex = 0;
  let winnerIndex = 0;

  while (donorIndex < donors.length && winnerIndex < winners.length) {
    const donor = donors[donorIndex];
    const winner = winners[winnerIndex];
    const amount = Math.min(donor.available, winner.capacity);
    if (amount < 1) {
      if (donor.available <= winner.capacity) {
        donorIndex += 1;
      } else {
        winnerIndex += 1;
      }
      continue;
    }

    plan.push({
      fromCampaignId: String(donor.campaign._id),
      toCampaignId: String(winner.campaign._id),
      amount: Number(amount.toFixed(2)),
    });

    donor.available = Number((donor.available - amount).toFixed(2));
    winner.capacity = Number((winner.capacity - amount).toFixed(2));

    if (donor.available <= 1) donorIndex += 1;
    if (winner.capacity <= 1) winnerIndex += 1;
  }

  return plan;
}

async function updateCampaignBudget(options: {
  campaign: any;
  oldBudget: number;
  newBudget: number;
  metaMockMode: boolean;
  actionType: "SCALE" | "DECREASE";
  note: string;
  now: Date;
}): Promise<{ ok: boolean; reason?: string }> {
  const { campaign, oldBudget, newBudget, metaMockMode, actionType, note, now } = options;

  if (!campaign.metaAdsetId) {
    return { ok: false, reason: "Campaign is missing metaAdsetId" };
  }

  const user = await User.findById(campaign.userId)
    .select("_id email metaAccessToken metaSystemUserToken metaAdAccountId metaPageId metaReconnectNeeded metaHealthStatus lastMetaHealthError metaHealthCooldownUntil metaLastSuccessfulHealthCheckAt")
    .lean() as any;
  const accessToken = String(user?.metaSystemUserToken || user?.metaAccessToken || "").trim();

  if (!accessToken && !metaMockMode) {
    return { ok: false, reason: "Meta access token missing" };
  }

  let metaResponseDetails: Record<string, any> = {};

  if (metaMockMode) {
    metaResponseDetails = { mock: true, message: note };
  } else {
    const metaHealth = await checkMetaWriteReadiness({
      user,
      userEmail: String(user?.email || campaign.userEmail || "").toLowerCase(),
      accessToken,
      pageId: String(campaign.facebookPageId || user?.metaPageId || "").trim(),
      adAccountId: String(campaign.adAccountId || user?.metaAdAccountId || "").trim(),
    });
    if (!metaHealth.ok) {
      return { ok: false, reason: metaHealth.reason };
    }

    const params = new URLSearchParams();
    params.set("daily_budget", String(Math.round(newBudget * 100)));
    params.set("access_token", accessToken);

    const resp = await fetch(`https://graph.facebook.com/v19.0/${campaign.metaAdsetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = await resp.json();
    if (!resp.ok) {
      await markMetaHealthFailure({
        user,
        userEmail: String(user?.email || campaign.userEmail || "").toLowerCase(),
        error: json,
      }).catch(() => {});
      return { ok: false, reason: `Meta budget update failed: ${JSON.stringify(json)}` };
    }
    metaResponseDetails = json;
  }

  await FBLeadCampaign.updateOne(
    { _id: campaign._id },
    { $set: { dailyBudget: newBudget, lastAutomationActionAt: now } }
  );

  await CampaignActionLog.create({
    userId: campaign.userId,
    campaignId: campaign._id,
    actionType,
    oldBudget,
    newBudget,
    metaResponse: {
      ...metaResponseDetails,
      summary: {
        reallocation: true,
        message: note,
      },
    },
    createdAt: now,
  });

  campaign.dailyBudget = newBudget;
  campaign.lastAutomationActionAt = now;

  return { ok: true };
}

async function applyReallocationPlan(
  plan: ReallocationEntry[],
  campaigns: any[],
  metaMockMode: boolean
): Promise<{ plan: ReallocationEntry[]; applied: ReallocationEntry[]; skipped: Array<ReallocationEntry & { reason: string }>; message: string }> {
  const now = new Date();
  const campaignMap = new Map<string, any>(campaigns.map((c) => [String(c._id), c]));
  const applied: ReallocationEntry[] = [];
  const skipped: Array<ReallocationEntry & { reason: string }> = [];

  for (const move of plan) {
    const donor = campaignMap.get(move.fromCampaignId);
    const recipient = campaignMap.get(move.toCampaignId);

    if (!donor || !recipient) {
      skipped.push({ ...move, reason: "Campaign not found" });
      continue;
    }

    const donorOld = Number(donor.dailyBudget || 0);
    const recipientOld = Number(recipient.dailyBudget || 0);
    const donorNew = Number((donorOld - move.amount).toFixed(2));
    const recipientNew = Number((recipientOld + move.amount).toFixed(2));

    const donorGuard = getGuardrailReason(donor, { now, oldBudget: donorOld, newBudget: donorNew });
    const recipientGuard = getGuardrailReason(recipient, { now, oldBudget: recipientOld, newBudget: recipientNew });

    if (donorGuard || recipientGuard) {
      skipped.push({
        ...move,
        reason: donorGuard ? `Donor guardrail: ${donorGuard}` : `Recipient guardrail: ${recipientGuard}`,
      });
      continue;
    }

    const donorResult = await updateCampaignBudget({
      campaign: donor,
      oldBudget: donorOld,
      newBudget: donorNew,
      metaMockMode,
      actionType: "DECREASE",
      note: `Reallocation: freed $${move.amount.toFixed(2)}.`,
      now,
    });

    if (!donorResult.ok) {
      skipped.push({ ...move, reason: donorResult.reason || "Failed to decrease donor budget" });
      continue;
    }

    const recipientResult = await updateCampaignBudget({
      campaign: recipient,
      oldBudget: recipientOld,
      newBudget: recipientNew,
      metaMockMode,
      actionType: "SCALE",
      note: `Reallocation: received $${move.amount.toFixed(2)}.`,
      now,
    });

    if (!recipientResult.ok) {
      skipped.push({ ...move, reason: recipientResult.reason || "Failed to increase recipient budget" });

      await updateCampaignBudget({
        campaign: donor,
        oldBudget: donorNew,
        newBudget: donorOld,
        metaMockMode,
        actionType: "SCALE",
        note: "Reallocation revert due to recipient failure.",
        now,
      });
      continue;
    }

    applied.push(move);
  }

  return {
    plan,
    applied,
    skipped,
    message: applied.length ? "Budget reallocation applied." : "No reallocations were applied.",
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (req.method === "GET") {
    const token = String(req.query.token || "");
    if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    console.log("[auto-optimize] Authorized cron execution");
  }

  await mongooseConnect();

  const body = (req.method === "POST" ? req.body : {}) || {};
  const isPreviewRequest = req.method === "POST" && body.preview === true;
  const previewReallocation = req.method === "POST" && body.previewReallocation === true;
  const applyReallocation = req.method === "POST" && body.applyReallocation === true;
  const metaMockMode = process.env.META_MOCK_MODE === "true";
  const session = await getServerSession(req, res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return res.status(403).json({ error: 'Forbidden' });
  const sessionEmail =
    typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  const requiresSession =
    isPreviewRequest ||
    previewReallocation ||
    applyReallocation ||
    (req.method === "POST" && typeof body.accountBudgetCap !== "undefined");
  if (requiresSession && !sessionEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "POST" && typeof body.accountBudgetCap !== "undefined") {
    const capInput = Number(body.accountBudgetCap);
    if (!Number.isFinite(capInput) || capInput < 0) {
      return res.status(400).json({ error: "accountBudgetCap must be a non-negative number" });
    }
    const normalizedCap = Number(capInput.toFixed(2));
    await FBLeadCampaign.updateMany(
      { userEmail: sessionEmail },
      { $set: { accountBudgetCap: normalizedCap } }
    );
    return res.status(200).json({ ok: true, accountBudgetCap: normalizedCap });
  }

  if (previewReallocation || applyReallocation) {
    if (!sessionEmail) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userCampaignQuery: Record<string, any> = {
      automationEnabled: true,
      metaCampaignId: { $exists: true, $ne: "" },
      metaAdsetId: { $exists: true, $ne: "" },
      userEmail: sessionEmail,
    };
    const campaigns = await FBLeadCampaign.find(userCampaignQuery).lean();

    const plan = buildReallocationPlan(campaigns);
    const totalDailyBudgetValue = campaigns.reduce(
      (sum: number, c: any) => sum + Number(c.dailyBudget || 0),
      0
    );
    const accountCapValue =
      campaigns.reduce((cap: number, c: any) => cap || Number(c.accountBudgetCap || 0), 0) || 0;
    const capReached = accountCapValue > 0 && totalDailyBudgetValue >= accountCapValue;

    if (previewReallocation) {
      return res.status(200).json({
        plan,
        totalDailyBudget: Number(totalDailyBudgetValue.toFixed(2)),
        accountBudgetCap: accountCapValue,
        capReached,
        reallocationMovesProposed: plan.length,
      });
    }

    const applyResult = await applyReallocationPlan(plan, campaigns, metaMockMode);
    return res.status(200).json({
      ...applyResult,
      totalDailyBudget: Number(totalDailyBudgetValue.toFixed(2)),
      accountBudgetCap: accountCapValue,
      capReached,
      reallocationMovesProposed: plan.length,
      reallocationMovesApplied: applyResult.applied.length,
    });
  }

  if (req.method === "POST" && !isPreviewRequest) {
    const { campaignId, automationEnabled } = body;
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

  const skipMetaCalls = metaMockMode || isPreviewRequest;

  const now = new Date();
  const summary: Summary = {
    processed: 0,
    scaled: 0,
    paused: 0,
    fixed: 0,
    duplicated: 0,
    decreased: 0,
    skipped: 0,
    skippedReasons: {},
    totalDailyBudget: 0,
    accountBudgetCap: 0,
    capReached: false,
    reallocationMovesProposed: 0,
    reallocationMovesApplied: 0,
    fatiguedCampaigns: 0,
  };

  const campaignQuery: Record<string, any> = {
    automationEnabled: true,
    metaCampaignId: { $exists: true, $ne: "" },
    metaAdsetId: { $exists: true, $ne: "" },
  };
  if (isPreviewRequest && sessionEmail) {
    campaignQuery.userEmail = sessionEmail;
  }

  const campaigns = await FBLeadCampaign.find(campaignQuery).lean();

  const userBudgetState = buildUserBudgetState(campaigns as any[]);
  const initialTotalDailyBudget = campaigns.reduce(
    (sum: number, c: any) => sum + Number(c.dailyBudget || 0),
    0
  );
  let totalDailyBudgetTracker = initialTotalDailyBudget;
  const scopedAccountBudgetCap =
    (isPreviewRequest && sessionEmail
      ? campaigns.reduce((cap: number, c: any) => cap || Number(c.accountBudgetCap || 0), 0)
      : 0) || 0;
  summary.accountBudgetCap = scopedAccountBudgetCap;
  let accountCapGuardTriggered = false;

  for (const campaign of campaigns as any[]) {
    summary.processed += 1;
    const userKey = String(campaign.userId || campaign.userEmail || "");
    const userState =
      userBudgetState.get(userKey) || {
        totalBudget: Number(campaign.dailyBudget || 0),
        cap: 0,
      };
    if (!userBudgetState.has(userKey)) {
      userBudgetState.set(userKey, userState);
    }

    // Skip campaigns whose Meta connection is broken — avoid making API calls that will fail
    const health = String(campaign.metaObjectHealth || "");
    const syncStatus = String(campaign.metaSyncStatus || "");
    if (
      health === "disconnected" ||
      health === "token_expired" ||
      syncStatus === "token_expired"
    ) {
      recordSkip(summary, SKIP_CODES.NO_ACCESS);
      continue;
    }

    const lastActionAt = campaign.lastAutomationActionAt ? new Date(campaign.lastAutomationActionAt) : null;
    if (lastActionAt && now.getTime() - lastActionAt.getTime() < FORTY_EIGHT_HOURS_MS) {
      recordSkip(summary, SKIP_CODES.COOLDOWN);
      continue;
    }

    const createdAt = campaign.createdAt ? new Date(campaign.createdAt) : null;
    if (
      campaign.performanceClass === "PAUSE" &&
      createdAt &&
      now.getTime() - createdAt.getTime() < THREE_DAYS_MS
    ) {
      recordSkip(summary, SKIP_CODES.GUARDRAIL_PAUSE);
      continue;
    }

    const dailyBudget = Number(campaign.dailyBudget || 0);
    const spend = Number(campaign.totalSpend || 0);
    const leads = Number(campaign.totalLeads || 0);
    const targetCpl = Number(campaign.targetCpl || 0);
    const cpl = Number(campaign.cpl || 0);

    const previousPerformanceScore = Number(campaign.performanceScore ?? 0);
    const previousAvgCpl = Number(
      campaign.previousAvgCpl ?? campaign.avgCpl ?? campaign.cpl ?? 0
    );
    const outcomeMetrics = getOutcomeMetrics(campaign);
    const leadQualityScore = calculateLeadQualityScore(campaign, outcomeMetrics);
    const appointments = outcomeMetrics.appointments;
    const sales = outcomeMetrics.sales;
    const answered = outcomeMetrics.answered;
    const rawCostPerAppointment = appointments > 0 ? spend / appointments : 0;
    const rawCostPerSale = sales > 0 ? spend / sales : 0;
    const appointmentRateRaw = leads > 0 ? appointments / leads : 0;
    const closeRateRaw = appointments > 0 ? sales / appointments : 0;
    const contactRateRaw = leads > 0 ? answered / leads : 0;
    const costPerAppointment = appointments > 0 ? Number(rawCostPerAppointment.toFixed(2)) : 0;
    const costPerSale = sales > 0 ? Number(rawCostPerSale.toFixed(2)) : 0;
    const appointmentRate = Number(appointmentRateRaw.toFixed(4));
    const closeRate = Number(closeRateRaw.toFixed(4));
    const contactRate = Number(contactRateRaw.toFixed(4));
    const appointmentTarget = Number(
      campaign.targetCostPerBooked ?? campaign.targetCostPerAppointment ?? 0
    );
    const computedPerformanceScore = calculatePerformanceScore({
      targetCpl,
      actualCpl: cpl,
      leadQualityScore,
      appointmentTarget,
      costPerAppointment: rawCostPerAppointment,
      closeRate: closeRateRaw,
    });
    const creativeFatigueDetected = detectCreativeFatigue(campaign);
    if (creativeFatigueDetected) {
      summary.fatiguedCampaigns += 1;
    }
    const metricUpdates: Record<string, any> = {};
    if (campaign.leadQualityScore !== leadQualityScore) {
      metricUpdates.leadQualityScore = leadQualityScore;
    }
    if (campaign.performanceScore !== computedPerformanceScore) {
      metricUpdates.performanceScore = computedPerformanceScore;
    }
    if (campaign.appointments !== appointments) {
      metricUpdates.appointments = appointments;
    }
    if (campaign.sales !== sales) {
      metricUpdates.sales = sales;
    }
    if (campaign.costPerAppointment !== costPerAppointment) {
      metricUpdates.costPerAppointment = costPerAppointment;
    }
    if (campaign.costPerSale !== costPerSale) {
      metricUpdates.costPerSale = costPerSale;
    }
    if (campaign.appointmentRate !== appointmentRate) {
      metricUpdates.appointmentRate = appointmentRate;
    }
    if (campaign.closeRate !== closeRate) {
      metricUpdates.closeRate = closeRate;
    }
    if (campaign.contactRate !== contactRate) {
      metricUpdates.contactRate = contactRate;
    }
    if (!!campaign.creativeFatigue !== creativeFatigueDetected) {
      metricUpdates.creativeFatigue = creativeFatigueDetected;
    }
    if (!!campaign.creativeRefreshNeeded !== creativeFatigueDetected) {
      metricUpdates.creativeRefreshNeeded = creativeFatigueDetected;
    }
    const cplSpikeFlag = previousAvgCpl > 0 && cpl > previousAvgCpl * 1.25;
    const performanceDropFlag =
      previousPerformanceScore > 0 && computedPerformanceScore < previousPerformanceScore * 0.8;
    const shouldRecommendReplaceAd = creativeFatigueDetected || cplSpikeFlag || performanceDropFlag;
    const lastNewAdAt = campaign.lastDuplicatedAt ? new Date(campaign.lastDuplicatedAt) : null;
    const noRecentAd = !lastNewAdAt || now.getTime() - lastNewAdAt.getTime() > SEVEN_DAYS_MS;
    const shouldRecommendNewAd = computedPerformanceScore > 85 && leads >= 5 && noRecentAd;
    if (!!campaign.recommendReplaceAd !== shouldRecommendReplaceAd) {
      metricUpdates.recommendReplaceAd = shouldRecommendReplaceAd;
    }
    if (!!campaign.recommendNewAd !== shouldRecommendNewAd) {
      metricUpdates.recommendNewAd = shouldRecommendNewAd;
    }
    const lastRecommendationEmailAtDate = campaign.lastRecommendationEmailAt
      ? new Date(campaign.lastRecommendationEmailAt)
      : null;
    const shouldSendRecommendationEmail =
      (shouldRecommendReplaceAd || shouldRecommendNewAd) &&
      campaign.userEmail &&
      (!lastRecommendationEmailAtDate ||
        now.getTime() - lastRecommendationEmailAtDate.getTime() > FORTY_EIGHT_HOURS_MS);

    if (shouldSendRecommendationEmail) {
      const reasonParts: string[] = [];
      if (shouldRecommendReplaceAd) {
        if (creativeFatigueDetected) {
          reasonParts.push("Creative fatigue indicators are rising.");
        } else if (cplSpikeFlag) {
          reasonParts.push("CPL has increased more than 25% vs the recent average.");
        } else if (performanceDropFlag) {
          reasonParts.push("Performance score dropped more than 20% week over week.");
        }
      }
      if (shouldRecommendNewAd) {
        reasonParts.push("Campaign momentum is strong and ready for a fresh ad variation.");
      }
      const reasonText = reasonParts.join(" ") || "Campaign trend suggests taking fresh action.";
      const subject = shouldRecommendReplaceAd
        ? "Your Facebook ad is declining — replace recommended"
        : "Your campaign is performing well — launch a new ad";
      const baseUrl =
        (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://www.covecrm.com").replace(
          /\/$/,
          ""
        );
      const ctaUrl = `${baseUrl}/facebook-ads?generateForCampaign=${campaign._id}`;
      const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
          <h2 style="margin:0 0 12px 0;">${campaign.campaignName}</h2>
          <p style="margin:0 0 12px 0;">${reasonText}</p>
          <ul style="margin:0 0 16px 16px; padding:0;">
            <li><strong>CPL:</strong> $${Number(cpl || 0).toFixed(2)}</li>
            <li><strong>Leads:</strong> ${Number(leads || 0)}</li>
            <li><strong>Performance score:</strong> ${computedPerformanceScore.toFixed(1)}</li>
          </ul>
          <p style="margin:0 0 16px 0;">
            <a href="${ctaUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">
              Open campaign & launch the recommended ad
            </a>
          </p>
        </div>
      `;
      try {
        await sendEmail(String(campaign.userEmail).toLowerCase(), subject, html);
        metricUpdates.lastRecommendationEmailAt = now;
        campaign.lastRecommendationEmailAt = now;
      } catch (err) {
        console.error("[facebook/auto-optimize] email send failed", {
          campaignId: String(campaign._id),
          error: err,
        });
      }
    }

    if (Object.keys(metricUpdates).length) {
      await FBLeadCampaign.updateOne(
        { _id: campaign._id },
        { $set: metricUpdates }
      );
      Object.assign(campaign, metricUpdates);
    }

    let actionType: "SCALE" | "PAUSE" | "FIX" | "DUPLICATE_TEST" | null = null;
    let newBudget = dailyBudget;
    let pauseOriginalAfterDuplicate = false;
    let autopilotAction: "AUTO_PAUSE_POOR_PERFORMANCE" | "AUTO_DUPLICATE_WINNER" | null = null;

    const lastDuplicatedAtDate = campaign.lastDuplicatedAt ? new Date(campaign.lastDuplicatedAt) : null;
    const shouldAutoPause = computedPerformanceScore < 40 && spend > 50 && leads < 2;
    const shouldAutoDuplicate =
      computedPerformanceScore > 90 &&
      leads >= 5 &&
      (!lastDuplicatedAtDate || now.getTime() - lastDuplicatedAtDate.getTime() > SEVEN_DAYS_MS);

    if (shouldAutoPause) {
      actionType = "PAUSE";
      autopilotAction = "AUTO_PAUSE_POOR_PERFORMANCE";
      newBudget = dailyBudget;
    } else if (shouldAutoDuplicate) {
      actionType = "DUPLICATE_TEST";
      autopilotAction = "AUTO_DUPLICATE_WINNER";
      newBudget = Number((dailyBudget * 1.2).toFixed(2));
      pauseOriginalAfterDuplicate = false;
    }

    if (!actionType) {
      if (!targetCpl || targetCpl <= 0) {
        recordSkip(summary, SKIP_CODES.MISSING_TARGET);
        continue;
      }

      if (leads < 5) {
        recordSkip(summary, SKIP_CODES.LEAD_MIN);
        continue;
      }

      if (spend < 2 * targetCpl) {
        recordSkip(summary, SKIP_CODES.SPEND_MIN);
        continue;
      }

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
    }

    if (!actionType) {
      recordSkip(summary, SKIP_CODES.NO_ACTION);
      continue;
    }

    const guardrailReason = getGuardrailReason(campaign, {
      now,
      oldBudget: dailyBudget,
      newBudget,
    });
    let accountCapReason: string | null = null;
    if (actionType === "SCALE") {
      const projectedTotal = userState.totalBudget + (newBudget - dailyBudget);
      if (userState.cap > 0 && projectedTotal > userState.cap) {
        accountCapReason = "Account budget cap reached";
      }
    }
    const combinedGuardrailReason = guardrailReason || accountCapReason;

    if (combinedGuardrailReason) {
      recordSkip(summary, SKIP_CODES.GUARDRAIL);
      await CampaignActionLog.create({
        userId: campaign.userId,
        campaignId: campaign._id,
        actionType,
        oldBudget: dailyBudget,
        newBudget,
        metaResponse: {
          summary: {
            skipped: true,
            reason: `Guardrail: ${combinedGuardrailReason}`,
          },
        },
        createdAt: now,
      });
      if (accountCapReason) {
        accountCapGuardTriggered = true;
      }
      continue;
    }

    const user = await User.findById(campaign.userId)
      .select("_id email metaAccessToken metaSystemUserToken metaAdAccountId metaPageId metaReconnectNeeded metaHealthStatus lastMetaHealthError metaHealthCooldownUntil metaLastSuccessfulHealthCheckAt")
      .lean() as any;
    const accessToken = String(user?.metaSystemUserToken || user?.metaAccessToken || "").trim();
    if (!accessToken && !skipMetaCalls) {
      recordSkip(summary, SKIP_CODES.NO_ACCESS);
      continue;
    }

    if (!skipMetaCalls) {
      const metaHealth = await checkMetaWriteReadiness({
        user,
        userEmail: String(user?.email || campaign.userEmail || "").toLowerCase(),
        accessToken,
        pageId: String(campaign.facebookPageId || user?.metaPageId || "").trim(),
        adAccountId: String(campaign.adAccountId || user?.metaAdAccountId || "").trim(),
      });
      if (!metaHealth.ok) {
        recordSkip(summary, SKIP_CODES.META_HEALTH);
        await FBLeadCampaign.updateOne(
          { _id: campaign._id },
          {
            $set: {
              metaObjectHealth: metaHealth.status === "reconnectNeeded" ? "token_expired" : "sync_failed",
              metaSyncStatus: metaHealth.status === "reconnectNeeded" ? "token_expired" : "sync_failed",
              metaSyncError: metaHealth.reason,
            },
          }
        ).catch(() => {});
        continue;
      }
    }

    const metaResponse: Record<string, any> = {};

    try {
      if (actionType === "PAUSE") {
        if (skipMetaCalls) {
          metaResponse.pause = { mock: true, message: "Mock: Campaign would be paused." };
        } else {
          const params = new URLSearchParams();
          params.set("status", "PAUSED");
          params.set("access_token", accessToken);

          const resp = await fetch(`https://graph.facebook.com/v19.0/${campaign.metaCampaignId}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
          });
          const json = await resp.json();
          if (!resp.ok) {
            await markMetaHealthFailure({ user, userEmail: String(user?.email || campaign.userEmail || "").toLowerCase(), error: json }).catch(() => {});
            throw new Error(JSON.stringify(json));
          }
          metaResponse.pause = json;
        }
        summary.paused += 1;
      }

      if (actionType === "SCALE") {
        if (skipMetaCalls) {
          metaResponse.scale = {
            mock: true,
            message: `Mock: Budget would be increased from $${dailyBudget.toFixed(2)} → $${newBudget.toFixed(2)}.`,
          };
        } else {
          const params = new URLSearchParams();
          params.set("daily_budget", String(Math.round(newBudget * 100)));
          params.set("access_token", accessToken);

          const resp = await fetch(`https://graph.facebook.com/v19.0/${campaign.metaAdsetId}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
          });
          const json = await resp.json();
          if (!resp.ok) {
            await markMetaHealthFailure({ user, userEmail: String(user?.email || campaign.userEmail || "").toLowerCase(), error: json }).catch(() => {});
            throw new Error(JSON.stringify(json));
          }
          metaResponse.scale = json;
        }
        const budgetDelta = newBudget - dailyBudget;
        userState.totalBudget += budgetDelta;
        totalDailyBudgetTracker += budgetDelta;
        summary.scaled += 1;
      }

      if (actionType === "FIX") {
        if (skipMetaCalls) {
          metaResponse.fix = {
            mock: true,
            message: `Mock: Targeting/creative adjustments would be applied at $${newBudget.toFixed(2)}.`,
            pauseOriginalAfterDuplicate,
          };
        } else {
          const copyParams = new URLSearchParams();
          copyParams.set("access_token", accessToken);
          copyParams.set("daily_budget", String(Math.round(newBudget * 100)));

          const copyResp = await fetch(`https://graph.facebook.com/v19.0/${campaign.metaAdsetId}/copies`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: copyParams.toString(),
          });
          const copyJson = await copyResp.json();
          if (!copyResp.ok) {
            await markMetaHealthFailure({ user, userEmail: String(user?.email || campaign.userEmail || "").toLowerCase(), error: copyJson }).catch(() => {});
            throw new Error(JSON.stringify(copyJson));
          }
          metaResponse.fix = copyJson;

          if (pauseOriginalAfterDuplicate) {
            const pauseParams = new URLSearchParams();
            pauseParams.set("status", "PAUSED");
            pauseParams.set("access_token", accessToken);
            await fetch(`https://graph.facebook.com/v19.0/${campaign.metaAdsetId}`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: pauseParams.toString(),
            });
          }
        }
        summary.fixed += 1;
      }

      if (actionType === "DUPLICATE_TEST") {
        if (skipMetaCalls) {
          metaResponse.duplicate = {
            mock: true,
            message: `Mock: Campaign would be duplicated with $${newBudget.toFixed(2)} daily budget.`,
            pauseOriginalAfterDuplicate,
          };
        } else {
          const copyParams = new URLSearchParams();
          copyParams.set("access_token", accessToken);
          copyParams.set("daily_budget", String(Math.round(newBudget * 100)));

          const copyResp = await fetch(`https://graph.facebook.com/v19.0/${campaign.metaCampaignId}/copies`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: copyParams.toString(),
          });
          const copyJson = await copyResp.json();
          if (!copyResp.ok) {
            await markMetaHealthFailure({ user, userEmail: String(user?.email || campaign.userEmail || "").toLowerCase(), error: copyJson }).catch(() => {});
            throw new Error(JSON.stringify(copyJson));
          }
          metaResponse.duplicate = copyJson;

          if (pauseOriginalAfterDuplicate) {
            const pauseParams = new URLSearchParams();
            pauseParams.set("status", "PAUSED");
            pauseParams.set("access_token", accessToken);
            await fetch(`https://graph.facebook.com/v19.0/${campaign.metaCampaignId}`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: pauseParams.toString(),
            });
          }
        }
        summary.duplicated += 1;
      }

      const autopilotMessages: Record<string, string> = {
        AUTO_PAUSE_POOR_PERFORMANCE: "Auto Pause triggered due to poor performance safeguards.",
        AUTO_DUPLICATE_WINNER: "Auto Duplicate triggered for high-performing campaign.",
      };
      const defaultSummaryMessage =
        (metaResponse.pause as any)?.message ||
        (metaResponse.scale as any)?.message ||
        (metaResponse.fix as any)?.message ||
        (metaResponse.duplicate as any)?.message ||
        `Auto-Optimize ${actionType} executed${metaMockMode ? " (mock)" : ""}.`;
      const summaryMessage = autopilotAction ? autopilotMessages[autopilotAction] : defaultSummaryMessage;

      if (!isPreviewRequest) {
        await CampaignActionLog.create({
          userId: campaign.userId,
          campaignId: campaign._id,
          actionType,
          oldBudget: dailyBudget,
          newBudget,
          metaResponse: {
            ...metaResponse,
            summary: {
              mock: metaMockMode,
              autoMode: true,
              dryRun: false,
              message: summaryMessage,
              autopilotAction,
            },
          },
          createdAt: now,
        });

        const postActionUpdates: Record<string, any> = { lastAutomationActionAt: now };
        if (autopilotAction === "AUTO_PAUSE_POOR_PERFORMANCE") {
          postActionUpdates.autoPaused = true;
        }
        if (autopilotAction === "AUTO_DUPLICATE_WINNER") {
          postActionUpdates.lastDuplicatedAt = now;
          postActionUpdates.duplicatedFromCampaignId = campaign._id;
          postActionUpdates.autoPaused = false;
        }

        await FBLeadCampaign.updateOne(
          { _id: campaign._id },
          { $set: postActionUpdates }
        );
      }
    } catch (err) {
      console.error("[facebook/auto-optimize] action failed", {
        campaignId: String(campaign._id),
        actionType,
        error: err,
      });
      recordSkip(summary, SKIP_CODES.NO_ACTION);
    }
  }

  if (isPreviewRequest && sessionEmail) {
    summary.reallocationMovesProposed = buildReallocationPlan(campaigns as any[]).length;
  }

  const finalTotal = isPreviewRequest ? initialTotalDailyBudget : totalDailyBudgetTracker;
  summary.totalDailyBudget = Number(finalTotal.toFixed(2));
  const capBaseline = summary.accountBudgetCap > 0 && finalTotal >= summary.accountBudgetCap;
  summary.capReached = accountCapGuardTriggered || capBaseline;

  return res.status(200).json(summary);
}
