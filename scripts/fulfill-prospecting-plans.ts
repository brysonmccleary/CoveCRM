// scripts/fulfill-prospecting-plans.ts
// Automatically fulfills active prospecting plans on a schedule.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import ProspectingPlan from "../models/ProspectingPlan";
import Folder from "../models/Folder";
import EmailCampaign from "../models/EmailCampaign";
import User from "../models/User";
import { assignLeadsToUser } from "../lib/prospecting/assignLeads";
import { checkAvailability } from "../lib/prospecting/checkLeadAvailability";

const DEFAULT_INTERVAL_DAYS =
  Number(process.env.PROSPECTING_PLAN_FULFILLMENT_DAYS || "30") || 30;
const LOCK_MINUTES =
  Number(process.env.PROSPECTING_PLAN_FULFILLMENT_LOCK_MINUTES || "10") || 10;
const MAX_BATCH =
  Number(process.env.PROSPECTING_PLAN_FULFILL_LIMIT || "5") || 5;
const RETRY_HOURS =
  Number(process.env.PROSPECTING_PLAN_RETRY_HOURS || "6") || 6;

type FulfillmentSummary = {
  plansFound: number;
  processed: number;
  fulfilledPlans: number;
  assignedLeads: number;
  skipped: number;
  rescheduled: number;
  errors: Array<{ planId: string; reason: string }>;
};

export async function fulfillProspectingPlans(limit = MAX_BATCH): Promise<FulfillmentSummary> {
  await mongooseConnect();

  const now = new Date();
  const summary: FulfillmentSummary = {
    plansFound: 0,
    processed: 0,
    fulfilledPlans: 0,
    assignedLeads: 0,
    skipped: 0,
    rescheduled: 0,
    errors: [],
  };

  const candidates = await ProspectingPlan.find({
    status: "active",
    autoFulfill: true,
    nextFulfillmentAt: { $lte: now },
  })
    .sort({ nextFulfillmentAt: 1 })
    .limit(limit)
    .lean();

  summary.plansFound = candidates.length;
  if (!candidates.length) return summary;

  for (const plan of candidates) {
    const locked = await ProspectingPlan.findOneAndUpdate(
      {
        _id: plan._id,
        status: "active",
        autoFulfill: true,
        nextFulfillmentAt: { $lte: now },
        $or: [
          { fulfillmentLockUntil: { $exists: false } },
          { fulfillmentLockUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          fulfillmentLockUntil: new Date(now.getTime() + LOCK_MINUTES * 60 * 1000),
        },
      },
      { new: true }
    );

    if (!locked) {
      summary.skipped += 1;
      continue;
    }

    summary.processed += 1;

    let refreshedPlan = await maybeRefreshPlanCycle(locked);

    try {
      const { folderId, campaignId } = await ensureTargets(refreshedPlan);

      const assignAmount = Math.min(
        refreshedPlan.planTier,
        Math.max(refreshedPlan.leadsRemaining || refreshedPlan.planTier, 0)
      );
      if (assignAmount <= 0) {
        await scheduleNext(refreshedPlan._id, RETRY_HOURS);
        summary.rescheduled += 1;
        continue;
      }

      const availability = await checkAvailability(refreshedPlan.userId, assignAmount);
      if (!availability.available) {
        summary.rescheduled += 1;
        await scheduleNext(refreshedPlan._id, RETRY_HOURS);
        continue;
      }

      const result = await assignLeadsToUser(
        refreshedPlan.userId,
        refreshedPlan.userEmail,
        assignAmount,
        refreshedPlan._id,
        folderId as any,
        campaignId as any
      );

      if (!result.assigned) {
        summary.rescheduled += 1;
        await scheduleNext(refreshedPlan._id, RETRY_HOURS);
        continue;
      }

      summary.assignedLeads += result.assigned;
      summary.fulfilledPlans += 1;

      await ProspectingPlan.updateOne(
        { _id: refreshedPlan._id },
        {
          $set: {
            folderId,
            campaignId,
            lastFulfilledAt: new Date(),
            nextFulfillmentAt: computeNextRunDate(refreshedPlan),
            fulfillmentLockUntil: null,
          },
        }
      );
    } catch (err: any) {
      summary.errors.push({
        planId: String(refreshedPlan._id),
        reason: err?.message || "Unknown error",
      });
      await scheduleNext(refreshedPlan._id, RETRY_HOURS);
    }
  }

  return summary;
}

async function maybeRefreshPlanCycle(plan: any) {
  const now = new Date();
  if (
    plan.autoRenew &&
    plan.periodEnd &&
    now >= new Date(plan.periodEnd) &&
    plan.status === "active"
  ) {
    const currentEnd = new Date(plan.periodEnd);
    const nextEnd = addMonths(currentEnd, 1);
    await ProspectingPlan.updateOne(
      { _id: plan._id },
      {
        $set: {
          periodStart: currentEnd,
          periodEnd: nextEnd,
          leadsAssigned: 0,
          leadsRemaining: plan.leadsIncluded,
          nextFulfillmentAt: currentEnd,
          lastFulfilledAt: null,
          fulfillmentLockUntil: null,
        },
      }
    );
    return ProspectingPlan.findById(plan._id).lean();
  }
  return plan;
}

async function ensureTargets(plan: any) {
  const user = await User.findById(plan.userId).lean();
  if (!user) throw new Error("User not found for plan");

  let folderId = plan.folderId;
  if (!folderId) {
    const monthYear = new Date().toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    const folderName = `Prospecting Leads — ${monthYear}`;
    const folder = await Folder.findOneAndUpdate(
      { userEmail: plan.userEmail, name: folderName },
      { $setOnInsert: { userEmail: plan.userEmail, name: folderName, assignedDrips: [] } },
      { new: true, upsert: true }
    );
    folderId = folder._id;
  }

  let campaignId = plan.campaignId;
  if (!campaignId) {
    let campaign = await EmailCampaign.findOne({
      userEmail: plan.userEmail,
      isActive: true,
    }).lean();

    if (!campaign) {
      campaign = await EmailCampaign.create({
        userId: plan.userId,
        userEmail: plan.userEmail,
        name: "Prospecting Outreach",
        isActive: true,
        fromName: user?.name || "",
        fromEmail: plan.userEmail,
        dailyLimit: 100,
        steps: [
          {
            day: 0,
            subject: "A quick note from {{agentName}}",
            html: `<p>Hi {{firstName}},</p><p>My name is ${user?.name || "a fellow agent"} and I wanted to reach out.</p><p>Would you be open to a quick call?</p><p>— ${user?.name || "Your Name"}</p>`,
            text: "",
          },
          {
            day: 3,
            subject: "Following up",
            html: `<p>Hi {{firstName}},</p><p>Just circling back on my note from earlier this week.</p><p>— ${user?.name || "Your Name"}</p>`,
            text: "",
          },
        ],
      });
    }
    campaignId = campaign._id;
  }

  if (!plan.folderId || !plan.campaignId) {
    await ProspectingPlan.updateOne(
      { _id: plan._id },
      { $set: { folderId, campaignId } }
    );
  }

  return { folderId, campaignId };
}

function computeNextRunDate(plan: any) {
  const intervalDays = plan.fulfillmentIntervalDays || DEFAULT_INTERVAL_DAYS;
  const next = new Date();
  next.setDate(next.getDate() + intervalDays);
  next.setHours(9, 0, 0, 0);
  return next;
}

async function scheduleNext(planId: any, hours: number) {
  await ProspectingPlan.updateOne(
    { _id: planId },
    {
      $set: {
        nextFulfillmentAt: new Date(Date.now() + hours * 60 * 60 * 1000),
        fulfillmentLockUntil: null,
      },
    }
  );
}

async function releaseLock(planId: any) {
  await ProspectingPlan.updateOne(
    { _id: planId },
    { $set: { fulfillmentLockUntil: null } }
  );
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

if (require.main === module) {
  fulfillProspectingPlans().then((summary) => {
    console.log("[fulfill-prospecting-plans]", summary);
    process.exit(0);
  }).catch((err) => {
    console.error("[fulfill-prospecting-plans] Fatal error", err);
    process.exit(1);
  });
}
