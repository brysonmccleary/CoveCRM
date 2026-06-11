// pages/api/cron/send-drip-messages.ts
//
// V2 Drip Worker — processes ScheduledDripMessage records that are due.
//
// IMPORTANT: Cron frequency ≠ text frequency.
// This endpoint runs every minute. It sends a message ONLY if a
// ScheduledDripMessage record already exists with status=pending and
// sendAt <= now. The cron cadence has NO relationship to how often
// leads receive texts. Text timing is determined entirely by the
// sendAt timestamp set at enrollment time.
//
// This worker NEVER:
//   - Creates new ScheduledDripMessage records
//   - Scans DripEnrollment or DripCampaign to decide who should be texted
//   - Recalculates who is due based on enrollment data
//   - Sends more than the registered records

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import ScheduledDripMessage from "@/models/ScheduledDripMessage";
import DripEnrollment from "@/models/DripEnrollment";
import Lead from "@/models/Lead";
import User from "@/models/User";
import DripCampaign from "@/models/DripCampaign";
import Message from "@/models/Message";
import { sendSms } from "@/lib/twilio/sendSMS";
import { DateTime } from "luxon";

export const config = { maxDuration: 55 };

// ── Config ───────────────────────────────────────────────────────────────────

const MAX_PER_INVOCATION = 50;      // max total sends per cron tick
const MAX_PER_USER = 10;            // max sends per user per tick (burst protection)
const MAX_DAILY_PER_LEAD = 2;       // safety cap: max drip messages per lead per day
const MAX_WEEKLY_PER_LEAD = 5;      // safety cap: max drip messages per lead per week
const MIN_COOLDOWN_MINUTES = 120;   // minimum minutes between automated drip sends to same lead
const STALE_SENDING_MINUTES = 5;    // records stuck in "sending" longer than this get reset

const SUPPRESSED_STATUS_TOKENS = [
  "booked",
  "sold",
  "not interested",
  "bad number",
  "wrong number",
  "do not call",
  "dnc",
];

// ── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextApiRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;

  const query = (req.query?.token as string) || "";
  const header = (req.headers["x-cron-key"] as string) || "";
  const bearer = ((req.headers.authorization as string) || "").replace(/^Bearer\s+/i, "");
  const vercelCron = Boolean(
    req.headers["x-vercel-cron"] ||
    req.headers["x-vercel-cron-job"] ||
    req.headers["x-vercel-cron-signature"]
  );

  return (
    query === secret ||
    header === secret ||
    bearer === secret ||
    (vercelCron && !!secret)
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeE164(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  const just = digits.replace(/\D/g, "");
  if (just.length === 10) return `+1${just}`;
  if (just.length === 11 && just.startsWith("1")) return `+${just}`;
  return null;
}

function isLeadStatusSuppressed(status?: string | null): boolean {
  if (!status) return false;
  const s = String(status).trim().toLowerCase();
  return SUPPRESSED_STATUS_TOKENS.some((t) => s.includes(t));
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ── Kill switch ──────────────────────────────────────────────────────────
  if (process.env.DRIPS_HARD_STOP === "1") {
    console.log("[send-drip-messages] DRIPS_HARD_STOP=1 — no sends this tick");
    return res.status(200).json({ ok: true, skipped: true, reason: "DRIPS_HARD_STOP" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  await dbConnect();

  const now = new Date();
  const stats = {
    dueFound: 0,    // total pending+due records found in DB this tick
    checked: 0,     // records processed (after per-user rate limit check)
    claimed: 0,     // records atomically claimed (pending → sending)
    sent: 0,
    skipped: 0,
    canceled: 0,
    failed: 0,
    rescheduled: 0,
    staleReset: 0,
    rateLimited: 0,
  };

  // ── Reset stale "sending" records ────────────────────────────────────────
  // Records stuck in "sending" for more than STALE_SENDING_MINUTES are
  // returned to "pending" so they can be retried.
  const staleThreshold = new Date(now.getTime() - STALE_SENDING_MINUTES * 60 * 1000);
  const staleResult = await ScheduledDripMessage.updateMany(
    {
      status: "sending",
      processingAt: { $lt: staleThreshold },
    },
    {
      $set: { status: "pending", processingAt: null, lockedAt: null },
      $inc: { attempts: 1 },
    }
  );
  stats.staleReset = (staleResult as any).modifiedCount ?? 0;

  // ── Per-user send counter (burst protection) ─────────────────────────────
  const userSendCount: Record<string, number> = {};

  // ── Fetch due records ────────────────────────────────────────────────────
  const dueRecords = await ScheduledDripMessage.find({
    status: "pending",
    sendAt: { $lte: now },
  })
    .sort({ sendAt: 1 }) // oldest due first
    .limit(MAX_PER_INVOCATION)
    .lean();

  stats.dueFound = dueRecords.length;

  for (const record of dueRecords) {
    stats.checked++;

    const userEmail = String(record.userEmail || "");

    // ── Per-user rate limit ────────────────────────────────────────────────
    const userCount = userSendCount[userEmail] || 0;
    if (userCount >= MAX_PER_USER) {
      stats.rateLimited++;
      continue;
    }

    // ── Atomic claim: pending → sending ───────────────────────────────────
    const claimed = await ScheduledDripMessage.findOneAndUpdate(
      { _id: record._id, status: "pending" },
      { $set: { status: "sending", processingAt: new Date(), lockedAt: new Date() } },
      { new: true }
    ).lean();

    if (!claimed) {
      // Another worker claimed it or it was already canceled
      continue;
    }
    stats.claimed++;

    try {
      // ── Gate 1: Lead ───────────────────────────────────────────────────
      const lead = await Lead.findById(record.leadId)
        .select({
          _id: 1,
          status: 1,
          Phone: 1,
          phone: 1,
          State: 1,
          state: 1,
          optOut: 1,
          unsubscribed: 1,
          isAIEngaged: 1,
          lastInboundAt: 1,
          userEmail: 1,
          ownerEmail: 1,
        })
        .lean();

      if (!lead) {
        await markCanceled(record._id, "lead_not_found");
        stats.canceled++;
        continue;
      }

      // ── Gate 2: Opt-out / unsubscribe ─────────────────────────────────
      if ((lead as any).optOut === true || (lead as any).unsubscribed === true) {
        await markCanceled(record._id, "lead_opted_out");
        stats.canceled++;
        continue;
      }

      // ── Gate 3: Lead status suppression ───────────────────────────────
      if (isLeadStatusSuppressed((lead as any).status)) {
        await markCanceled(record._id, `status:${(lead as any).status}`);
        stats.canceled++;
        continue;
      }

      // ── Gate 4: Lead has not replied (inbound = pause drip) ───────────
      if ((lead as any).lastInboundAt) {
        await markCanceled(record._id, "lead_replied");
        stats.canceled++;
        continue;
      }

      // ── Gate 5: AI engagement ──────────────────────────────────────────
      if ((lead as any).isAIEngaged === true) {
        await markCanceled(record._id, "ai_engaged");
        stats.canceled++;
        continue;
      }

      // ── Gate 6: User ───────────────────────────────────────────────────
      const user = await User.findOne({ email: userEmail })
        .select({ _id: 1, email: 1, name: 1 })
        .lean();

      if (!user) {
        await markCanceled(record._id, "user_not_found");
        stats.canceled++;
        continue;
      }

      // ── Gate 7: Enrollment still active ───────────────────────────────
      const enrollment = await DripEnrollment.findById(record.enrollmentId)
        .select({ _id: 1, status: 1, stopAll: 1, paused: 1, isPaused: 1 })
        .lean();

      if (
        !enrollment ||
        (enrollment as any).status === "canceled" ||
        (enrollment as any).status === "completed" ||
        (enrollment as any).stopAll === true
      ) {
        await markCanceled(record._id, "enrollment_stopped");
        stats.canceled++;
        continue;
      }

      // ── Gate 8: Campaign still active ─────────────────────────────────
      const campaign = await DripCampaign.findById(record.campaignId)
        .select({ _id: 1, isActive: 1, type: 1 })
        .lean();

      if (!campaign || (campaign as any).isActive !== true || (campaign as any).type !== "sms") {
        await markCanceled(record._id, "campaign_inactive");
        stats.canceled++;
        continue;
      }

      // ── Gate 9: Idempotency — already sent via Message model ──────────
      const existingMessage = await Message.findOne({
        idempotencyKey: record.idempotencyKey,
      })
        .select({ _id: 1, sid: 1 })
        .lean();

      if (existingMessage && (existingMessage as any).sid) {
        // Already successfully sent — mark as sent in our record
        await ScheduledDripMessage.updateOne(
          { _id: record._id },
          {
            $set: {
              status: "sent",
              sentAt: new Date(),
              messageSid: String((existingMessage as any).sid),
              processingAt: null,
            },
          }
        );
        stats.sent++;
        userSendCount[userEmail] = (userSendCount[userEmail] || 0) + 1;
        continue;
      }

      // ── Gate 10: Body not empty ────────────────────────────────────────
      const body = String(record.bodySnapshot || "").trim();
      if (!body) {
        await markSkipped(record._id, "empty_body");
        stats.skipped++;
        continue;
      }

      // ── Gate 11: Lead phone valid ──────────────────────────────────────
      const toPhone = normalizeE164(
        String(record.toNumber || (lead as any).Phone || (lead as any).phone || "")
      );
      if (!toPhone) {
        await markSkipped(record._id, "no_valid_phone");
        stats.skipped++;
        continue;
      }

      // ── Gate 12: Daily cap (max 2 drip messages per lead per day) ──────
      const todayStart = DateTime.utc().startOf("day").toJSDate();
      const dailySent = await ScheduledDripMessage.countDocuments({
        leadId: record.leadId,
        status: "sent",
        sentAt: { $gte: todayStart },
      });
      if (dailySent >= MAX_DAILY_PER_LEAD) {
        // Reschedule to tomorrow 9AM UTC
        const tomorrow = DateTime.utc().startOf("day").plus({ days: 1 }).set({ hour: 9 }).toJSDate();
        await reschedule(record._id, tomorrow, "daily_cap");
        stats.rescheduled++;
        continue;
      }

      // ── Gate 13: Weekly cap (max 5 drip messages per lead per week) ────
      const weekStart = DateTime.utc().startOf("week").toJSDate();
      const weeklySent = await ScheduledDripMessage.countDocuments({
        leadId: record.leadId,
        status: "sent",
        sentAt: { $gte: weekStart },
      });
      if (weeklySent >= MAX_WEEKLY_PER_LEAD) {
        // Reschedule to next week
        const nextWeek = DateTime.utc().startOf("week").plus({ weeks: 1 }).set({ hour: 9 }).toJSDate();
        await reschedule(record._id, nextWeek, "weekly_cap");
        stats.rescheduled++;
        continue;
      }

      // ── Gate 14: Cooldown (min 2 hours between drip sends to same lead) ─
      const cooldownThreshold = new Date(now.getTime() - MIN_COOLDOWN_MINUTES * 60 * 1000);
      const recentDrip = await ScheduledDripMessage.findOne({
        leadId: record.leadId,
        status: "sent",
        sentAt: { $gte: cooldownThreshold },
      })
        .sort({ sentAt: -1 })
        .select({ sentAt: 1 })
        .lean();

      if (recentDrip && (recentDrip as any).sentAt) {
        const rescheduledTo = new Date(
          new Date((recentDrip as any).sentAt).getTime() + MIN_COOLDOWN_MINUTES * 60 * 1000
        );
        await reschedule(record._id, rescheduledTo, "cooldown");
        stats.rescheduled++;
        continue;
      }

      // ── Send ───────────────────────────────────────────────────────────
      let sentSid: string | undefined;
      try {
        const result = await sendSms({
          to: toPhone,
          body,
          userEmail,
          leadId: String(record.leadId),
          idempotencyKey: String(record.idempotencyKey || ""),
          enrollmentId: String(record.enrollmentId),
          campaignId: String(record.campaignId),
          stepIndex: record.stepIndex,
          source: "drip",
        });
        sentSid = (result as any)?.sid || undefined;
      } catch (err: any) {
        const code = String(err?.code || "");
        const msg = String(err?.message || err || "");

        // Twilio 21610 = opt-out — cancel all pending for lead
        if (code === "21610" || msg.includes("21610")) {
          await Lead.updateOne({ _id: record.leadId }, { $set: { optOut: true, unsubscribed: true } });
          await ScheduledDripMessage.updateMany(
            { leadId: record.leadId, status: { $in: ["pending", "sending"] } },
            { $set: { status: "canceled", canceledAt: new Date(), cancelReason: "twilio_21610_optout" } }
          );
          stats.canceled++;
          continue;
        }

        // Permanent A2P / account errors
        const isPermanent = ["20003", "21211", "21614", "21408"].includes(code);
        if (isPermanent) {
          await ScheduledDripMessage.updateOne(
            { _id: record._id },
            {
              $set: {
                status: "failed",
                failReason: `twilio_${code}:${msg.slice(0, 200)}`,
                processingAt: null,
              },
            }
          );
          stats.failed++;
          continue;
        }

        // Transient error: increment attempts and reschedule
        const attemptCount = (record.attempts || 0) + 1;
        if (attemptCount >= 5) {
          await ScheduledDripMessage.updateOne(
            { _id: record._id },
            {
              $set: { status: "failed", failReason: `max_attempts:${msg.slice(0, 200)}`, processingAt: null },
              $inc: { attempts: 1 },
            }
          );
          stats.failed++;
        } else {
          const retryAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 min
          await ScheduledDripMessage.updateOne(
            { _id: record._id },
            {
              $set: { status: "pending", sendAt: retryAt, processingAt: null, failReason: msg.slice(0, 200) },
              $inc: { attempts: 1 },
            }
          );
          stats.rescheduled++;
        }
        continue;
      }

      // ── Mark sent ──────────────────────────────────────────────────────
      await ScheduledDripMessage.updateOne(
        { _id: record._id },
        {
          $set: {
            status: "sent",
            sentAt: new Date(),
            messageSid: sentSid || "",
            processingAt: null,
          },
        }
      );

      // Update enrollment's last-sent timestamp for observability
      await DripEnrollment.updateOne(
        { _id: record.enrollmentId },
        { $set: { lastSentAt: new Date() } }
      );

      stats.sent++;
      userSendCount[userEmail] = (userSendCount[userEmail] || 0) + 1;
    } catch (err: any) {
      // Unexpected error — reset to pending with attempt counter
      console.error("[send-drip-messages] Unexpected error processing record", {
        id: String(record._id),
        error: err?.message || err,
      });
      await ScheduledDripMessage.updateOne(
        { _id: record._id, status: "sending" },
        {
          $set: { status: "pending", processingAt: null },
          $inc: { attempts: 1 },
        }
      );
    }
  }

  console.log("[send-drip-messages]", JSON.stringify({ ...stats, nowISO: now.toISOString() }));

  return res.status(200).json({
    ok: true,
    nowISO: now.toISOString(),
    stats,
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function markCanceled(id: any, reason: string) {
  await ScheduledDripMessage.updateOne(
    { _id: id },
    { $set: { status: "canceled", canceledAt: new Date(), cancelReason: reason, processingAt: null } }
  );
}

async function markSkipped(id: any, reason: string) {
  await ScheduledDripMessage.updateOne(
    { _id: id },
    { $set: { status: "skipped", skippedAt: new Date(), failReason: reason, processingAt: null } }
  );
}

async function reschedule(id: any, sendAt: Date, reason: string) {
  await ScheduledDripMessage.updateOne(
    { _id: id },
    { $set: { status: "pending", sendAt, processingAt: null, failReason: reason } }
  );
}
