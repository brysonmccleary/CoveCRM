// pages/api/cron/platform-promo-queue.ts
// Daily cron — sends CoveCRM platform promo emails to eligible DOI leads.
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import DOILead from "@/models/DOILead";
import PlatformEmailRecord from "@/models/PlatformEmailRecord";
import PlatformSender from "@/models/PlatformSender";
import { sendPlatformPromo } from "@/lib/prospecting/sendPlatformPromo";

export const config = { maxDuration: 60 };

const MAX_PER_RUN = 500;
const MAX_ATTEMPTS = Number(process.env.PLATFORM_PROMO_MAX_ATTEMPTS || "3") || 3;
const PLACEHOLDER_EMAIL = /@noemail\.doilead\.local$/i;
const PROMO_STEP_DELAY_HOURS = Number(process.env.PLATFORM_PROMO_STEP_DELAY_HOURS || "72");
const PROMO_RETRY_DELAY_HOURS = Number(process.env.PLATFORM_PROMO_RETRY_DELAY_HOURS || "24");

// Default promo email content — controlled via env so marketing can revise copy without deploys.
const PROMO_SUBJECT =
  process.env.PLATFORM_PROMO_SUBJECT || "Grow your insurance book with CoveCRM";

const PROMO_HTML =
  process.env.PLATFORM_PROMO_HTML ||
  `<p>Hi there,</p>
<p>We'd love to help you close more insurance clients with CoveCRM — the CRM built for independent agents.</p>
<p><a href="${process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com"}">Start your free trial</a></p>
<p>— The CoveCRM Team</p>
<hr />
<p style="font-size:11px;color:#888;">
  To unsubscribe, <a href="${process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com"}/api/email/doi-unsubscribe?email={{EMAIL}}">click here</a>.
</p>`;

type PromoStep = {
  key: string;
  subject: string;
  html: string;
  delayHours?: number;
};

const BASE_STEPS = buildPromoSteps();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  if (!BASE_STEPS.length) {
    return res.status(200).json({ processed: 0, skipped: 0, reason: "No promo steps configured" });
  }

  await resetSenderCounters();

  const senders = (await PlatformSender.find({ active: true }).lean()) as any[];
  const totalCapacity = senders.reduce(
    (sum: number, s: any) => sum + Math.max(0, (s.dailyLimit || 200) - (s.sentToday || 0)),
    0
  );

  if (totalCapacity === 0) {
    return res.status(200).json({ processed: 0, skipped: 0, reason: "All senders at daily limit" });
  }

  const batchSize = Math.min(MAX_PER_RUN, totalCapacity);

  const sentEmails = await PlatformEmailRecord.distinct("toEmail", {
    platformSend: true,
    status: { $in: ["sent"] },
  });

  const andClauses: any[] = [];
  const now = new Date();

  const statusFilter = [
    { platformPromoStatus: { $exists: false } },
    { platformPromoStatus: { $in: ["pending", "failed", "suppressed"] } },
    {
      $and: [
        { platformPromoStatus: "sent" },
        { platformPromoStep: { $lt: BASE_STEPS.length } },
      ],
    },
  ];
  const attemptFilter = [
    { platformPromoAttempts: { $exists: false } },
    { platformPromoAttempts: { $lt: MAX_ATTEMPTS } },
  ];
  const dueFilter = [
    { platformPromoNextAt: { $exists: false } },
    { platformPromoNextAt: { $lte: now } },
  ];

  andClauses.push({ $or: statusFilter });
  andClauses.push({ $or: attemptFilter });
  andClauses.push({ $or: dueFilter });

  if (sentEmails.length) {
    andClauses.push({
      $or: [
        { platformPromoStep: { $gt: 0 } },
        { email: { $nin: sentEmails } },
      ],
    });
  }

  const candidateFilter: Record<string, any> = {
    globallyUnsubscribed: false,
    email: { $not: PLACEHOLDER_EMAIL },
    platformPromoStep: { $lt: BASE_STEPS.length },
    $and: andClauses,
  };

  const eligibleTotal = await DOILead.countDocuments(candidateFilter);
  if (!eligibleTotal) {
    return res.status(200).json({ processed: 0, skipped: 0, reason: "No eligible leads" });
  }

  const candidates = (await DOILead.find(candidateFilter)
    .select(
      "_id email leadScore platformPromoStatus platformPromoAttempts platformPromoStep platformPromoNextAt"
    )
    .sort({
      platformPromoStatus: 1,
      platformPromoLastAttemptAt: 1,
      leadScore: -1,
      scrapedAt: -1,
    })
    .limit(Math.min(batchSize, eligibleTotal))
    .lean()) as any[];

  if (!candidates.length) {
    return res.status(200).json({ processed: 0, skipped: 0, reason: "No eligible leads" });
  }

  const summary = {
    eligible: eligibleTotal,
    selected: candidates.length,
    attempted: 0,
    deliveredSteps: 0,
    queuedNextSteps: 0,
    suppressed: 0,
    failed: 0,
    skipped: 0,
    stoppedEarly: false,
    reasons: {} as Record<string, number>,
  };

  for (const lead of candidates) {
    const claimed = await claimLead(String(lead._id), statusFilter, attemptFilter, now);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    const stepIndex = claimed.platformPromoStep || 0;
    const step = BASE_STEPS[stepIndex];
    if (!step) {
      await DOILead.updateOne(
        { _id: claimed._id },
        {
          $set: {
            platformPromoStatus: "sent",
            platformPromoCompletedAt: new Date(),
            platformPromoNextAt: null,
          },
        }
      );
      summary.skipped += 1;
      continue;
    }

    const subject = step.subject;
    const html = injectEmail(step.html, claimed.email);

    const result = await sendPlatformPromo(String(claimed._id), { subject, html }, { stepIndex });
    summary.attempted += 1;

    if (result.ok) {
      const isFinalStep = stepIndex >= BASE_STEPS.length - 1;
      const setFields: Record<string, any> = {
        platformPromoReason: "",
        platformPromoLastAttemptAt: new Date(),
      };

      if (isFinalStep) {
        summary.deliveredSteps += 1;
        setFields.platformPromoStatus = "sent";
        setFields.platformPromoSentAt = new Date();
        setFields.platformPromoCompletedAt = new Date();
        setFields.platformPromoNextAt = null;
      } else {
        summary.queuedNextSteps += 1;
        const delay = step.delayHours ?? PROMO_STEP_DELAY_HOURS;
        setFields.platformPromoStatus = "pending";
        setFields.platformPromoStep = stepIndex + 1;
        setFields.platformPromoNextAt = new Date(Date.now() + delay * 60 * 60 * 1000);
      }

      await DOILead.updateOne(
        { _id: claimed._id },
        {
          $set: setFields,
          $inc: { platformPromoAttempts: 1 },
        }
      );
      continue;
    }

    if (result.suppressed) {
      summary.suppressed += 1;
      await finalizeLead(
        String(claimed._id),
        "suppressed",
        result.error || "suppressed",
        false
      );
      continue;
    }

    if (result.skipped) {
      const isCapacity =
        !!result.error &&
        (result.error.toLowerCase().includes("daily limit") ||
          result.error.toLowerCase().includes("sender"));
      if (isCapacity) {
        summary.stoppedEarly = true;
        await DOILead.updateOne(
          { _id: claimed._id },
          { $set: { platformPromoStatus: "pending", platformPromoLastAttemptAt: null } }
        );
        break;
      }

      summary.skipped += 1;
      await finalizeLead(
        String(claimed._id),
        "skipped",
        result.error || "skipped",
        true,
        { platformPromoNextAt: nextRetryDate() }
      );
      continue;
    }

    summary.failed += 1;
    await finalizeLead(String(claimed._id), "failed", result.error || "send_failed", true, {
      platformPromoNextAt: nextRetryDate(),
    });
  }

  return res.status(200).json({ ok: true, summary });
}

async function resetSenderCounters() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await PlatformSender.updateMany(
    { active: true, lastResetAt: { $lt: today } },
    { $set: { sentToday: 0, lastResetAt: new Date() } }
  );
}

async function claimLead(
  leadId: string,
  statusFilter: any[],
  attemptFilter: any[],
  now: Date
) {
  return DOILead.findOneAndUpdate(
    {
      _id: leadId,
      globallyUnsubscribed: false,
      email: { $not: PLACEHOLDER_EMAIL },
      $and: [{ $or: statusFilter }, { $or: attemptFilter }],
      platformPromoStep: { $lt: BASE_STEPS.length },
      $or: [
        { platformPromoNextAt: { $exists: false } },
        { platformPromoNextAt: { $lte: now } },
      ],
    },
    {
      $set: {
        platformPromoStatus: "sending",
        platformPromoLastAttemptAt: new Date(),
      },
    },
    { new: true }
  );
}

async function finalizeLead(
  leadId: string,
  status: "sent" | "suppressed" | "failed" | "skipped",
  reason: string,
  incrementAttempt = true,
  extraSet: Record<string, any> = {}
) {
  const update: Record<string, any> = {
    $set: {
      platformPromoStatus: status,
      platformPromoReason: reason,
      platformPromoLastAttemptAt: new Date(),
      ...extraSet,
    },
  };
  if (incrementAttempt) {
    update.$inc = { platformPromoAttempts: 1 };
  }
  await DOILead.updateOne({ _id: leadId }, update);
}

function buildPromoSteps(): PromoStep[] {
  const steps: PromoStep[] = [
    {
      key: "step1",
      subject: PROMO_SUBJECT,
      html: PROMO_HTML,
      delayHours: Number(process.env.PLATFORM_PROMO_STEP1_DELAY_HOURS || PROMO_STEP_DELAY_HOURS),
    },
  ];

  for (let i = 2; i <= 3; i += 1) {
    const subject = process.env[`PLATFORM_PROMO_STEP${i}_SUBJECT`];
    const html = process.env[`PLATFORM_PROMO_STEP${i}_HTML`];
    if (subject && html) {
      steps.push({
        key: `step${i}`,
        subject,
        html,
        delayHours: Number(
          process.env[`PLATFORM_PROMO_STEP${i}_DELAY_HOURS`] || PROMO_STEP_DELAY_HOURS
        ),
      });
    }
  }

  return steps;
}

function injectEmail(template: string, email: string) {
  return template.replace(/\{\{EMAIL\}\}/g, encodeURIComponent(email));
}

function nextRetryDate() {
  return new Date(Date.now() + PROMO_RETRY_DELAY_HOURS * 60 * 60 * 1000);
}
