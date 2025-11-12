// pages/api/cron/run-drips.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import { DateTime } from "luxon";

import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";
import DripCampaign from "@/models/DripCampaign";
import DripEnrollment from "@/models/DripEnrollment";
import { sendSms } from "@/lib/twilio/sendSMS";
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import { acquireLock } from "@/lib/locks";

export const config = { maxDuration: 60 };

const PT_ZONE = "America/Los_Angeles";
const DEFAULT_SEND_HOUR_PT = 9;
const PER_LEAD_CONCURRENCY =
  Math.max(1, parseInt(process.env.DRIP_CONCURRENCY || "10", 10)) || 10;

const SEND_HOUR_PT = Number.isFinite(Number(process.env.DRIPS_DEFAULT_HOUR_PT))
  ? Number(process.env.DRIPS_DEFAULT_HOUR_PT)
  : DEFAULT_SEND_HOUR_PT;

function isValidObjectId(id: string) {
  return /^[a-f0-9]{24}$/i.test(String(id || ""));
}

async function resolveDrip(dripId: string) {
  if (isValidObjectId(dripId)) return await DripCampaign.findById(dripId).lean();
  const def = prebuiltDrips.find((d) => d.id === dripId);
  if (!def) return null;
  return await DripCampaign.findOne({ isGlobal: true, name: def.name }).lean();
}

// canonical for comparisons/logging
function canonicalId(dripDoc: any, fallback: string) {
  return String(dripDoc?._id || fallback);
}

function parseDayNum(dayField?: string): number {
  if (!dayField) return NaN;
  const m = String(dayField).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

function normalizeToE164Maybe(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  const just = digits.replace(/\D/g, "");
  if (just.length === 10) return `+1${just}`;
  if (just.length === 11 && just.startsWith("1")) return `+${just}`;
  return null;
}

function computeWhenForDayPT(startedAt: Date, dayNum: number): Date {
  const startPT = DateTime.fromJSDate(startedAt, { zone: PT_ZONE }).startOf("day");
  const offsetDays = Math.max(0, (isNaN(dayNum) ? 1 : dayNum) - 1);
  return startPT.plus({ days: offsetDays }).set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

async function runBatched<T>(arr: T[], size: number, worker: (v: T, i: number) => Promise<void>) {
  for (let i = 0; i < arr.length; i += size) {
    const batch = arr.slice(i, i + size);
    await Promise.allSettled(batch.map((v, k) => worker(v, i + k)));
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ---- AUTH (cron, secret, or vercel) ----
  if (!["GET", "POST"].includes(req.method || "")) return res.status(405).json({ message: "Method not allowed" });

  const secret = process.env.CRON_SECRET || "";
  const queryToken = String(req.query?.token || "");
  const headerToken = String(req.headers["x-cron-key"] || "");
  const vercelCron = Boolean(req.headers["x-vercel-cron"]);

  const authorized = (!!secret && (queryToken === secret || headerToken === secret)) || vercelCron;
  if (!authorized) {
    res.setHeader("cache-control", "private, no-store");
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  if (process.env.DRIPS_HARD_STOP === "1") return res.status(204).end();

  const force = ["1","true","yes"].includes(String(req.query.force || "").toLowerCase());
  const dry   = ["1","true","yes"].includes(String(req.query.dry   || "").toLowerCase());
  const limit = Math.max(0, parseInt(String(req.query.limit || ""), 10) || 0);

  try {
    if (!mongoose.connection.readyState) await dbConnect();

    // 🎯 TICK-DRIVEN: we do NOT batch by “morning”. We only send enrollments with nextSendAt <= now
    const now = new Date();

    const dueQ = DripEnrollment.find({
      status: "active",
      nextSendAt: { $lte: now },
      $and: [
        { $or: [{ active: { $ne: false } }, { isActive: true }, { enabled: true }] },
        { $or: [{ paused: { $ne: true } }, { isPaused: { $ne: true } }] },
        { stopAll: { $ne: true } },
      ],
    }).select({ _id: 1, leadId: 1, userEmail: 1, campaignId: 1, cursorStep: 1, sentAtByIndex: 1, startedAt: 1, nextSendAt: 1 }).lean();

    const due = limit > 0 ? await dueQ.limit(limit) : await dueQ;

    let checked = 0, sent = 0, scheduled = 0, suppressed = 0, failed = 0, advanced = 0, completed = 0, inited = 0;

    await runBatched(due, PER_LEAD_CONCURRENCY, async (enr) => {
      checked++;

      // Atomic claim per enrollment & current step
      const claim = await DripEnrollment.findOneAndUpdate(
        { _id: enr._id, status: "active", nextSendAt: { $lte: new Date() }, cursorStep: enr.cursorStep ?? 0 },
        { $set: { processing: true, processingAt: new Date() } },
        { new: true }
      ).lean();

      if (!claim) return;

      const [lead, user, campaign] = await Promise.all([
        Lead.findById(claim.leadId).select({ _id: 1, Phone: 1, "First Name": 1, "Last Name": 1 }).lean(),
        User.findOne({ email: claim.userEmail }).select({ _id: 1, email: 1, name: 1 }).lean(),
        DripCampaign.findById(claim.campaignId).select({ _id: 1, name: 1, type: 1, isActive: 1, steps: 1 }).lean() as any,
      ]);

      if (!lead || !user?._id || !campaign || campaign.type !== "sms" || campaign.isActive !== true) {
        await DripEnrollment.updateOne({ _id: claim._id }, { $set: { processing: false }, $unset: { processingAt: 1 } });
        return;
      }

      const to = normalizeToE164Maybe((lead as any).Phone);
      if (!to) {
        await DripEnrollment.updateOne({ _id: claim._id }, { $set: { processing: false }, $unset: { processingAt: 1 } });
        return;
      }

      // Ensure steps
      const steps: Array<{ text?: string; day?: string }> = Array.isArray((campaign as any).steps) ? (campaign as any).steps : [];
      if (!steps.length) {
        await DripEnrollment.updateOne({ _id: claim._id }, { $set: { status: "completed", processing: false }, $unset: { processingAt: 1, nextSendAt: 1 } });
        completed++;
        return;
      }

      // Initialize startedAt/nextSendAt if missing (safety)
      if (!claim.startedAt) {
        const firstDay = parseDayNum(steps[0]?.day) || 1;
        const initialWhen = computeWhenForDayPT(new Date(), firstDay);
        await DripEnrollment.updateOne({ _id: claim._id }, { $set: { startedAt: new Date(), nextSendAt: initialWhen } });
        inited++;
      }

      const idx = Math.max(0, Number(claim.cursorStep || 0));
      const step = steps[idx];
      if (!step) {
        await DripEnrollment.updateOne({ _id: claim._id }, { $set: { status: "completed", processing: false }, $unset: { processingAt: 1, nextSendAt: 1 } });
        completed++;
        return;
      }

      // If already marked as sent for this index, just advance scheduling
      const already = (claim as any)?.sentAtByIndex && (claim as any).sentAtByIndex.get?.(String(idx));
      if (already) {
        const nextIndex = idx + 1;
        const update: any = { $set: { cursorStep: nextIndex, processing: false }, $unset: { processingAt: 1 } };
        if (nextIndex >= steps.length) {
          update.$set.status = "completed";
          update.$unset.nextSendAt = 1;
          completed++;
        } else {
          const nextDay = parseDayNum(steps[nextIndex]?.day) || (parseDayNum(step.day) || 1) + 1;
          const when = computeWhenForDayPT(claim.startedAt || new Date(), nextDay);
          update.$set.nextSendAt = when;
          advanced++;
        }
        await DripEnrollment.updateOne({ _id: claim._id, cursorStep: idx }, update);
        return;
      }

      // Fresh opt-out / paused re-check
      const fresh = await DripEnrollment.findById(claim._id).select({ status: 1, stopAll: 1, paused: 1, isPaused: 1 }).lean();
      if (!fresh || fresh.status !== "active" || fresh.stopAll === true || fresh.paused === true || fresh.isPaused === true) {
        await DripEnrollment.updateOne({ _id: claim._id }, { $set: { processing: false }, $unset: { processingAt: 1 } });
        return;
      }

      const { first: agentFirst, last: agentLast } = splitName(user.name || "");
      const firstName = (lead as any)["First Name"] || null;
      const lastName  = (lead as any)["Last Name"]  || null;
      const fullName  = [firstName, lastName].filter(Boolean).join(" ") || null;

      const bodyRendered = renderTemplate(String(step.text || ""), {
        contact: { first_name: firstName, last_name: lastName, full_name: fullName },
        agent: { name: user.name || null, first_name: agentFirst, last_name: agentLast },
      });
      const finalBody = ensureOptOut(bodyRendered);

      try {
        if (!dry) {
          const ok = await acquireLock("enroll", `${user.email}:${String(lead._id)}:${String(campaign._id)}:${String(idx)}`, 600);
          if (ok) {
            const idKey = `${String(claim._id)}:${idx}:${(claim.nextSendAt || new Date()).toISOString()}`;
            const resp = await sendSms({
              to, body: finalBody, userEmail: user.email, leadId: String(lead._id),
              idempotencyKey: idKey, enrollmentId: String(claim._id), campaignId: String(campaign._id), stepIndex: idx
            });
            if (resp?.scheduledAt) scheduled++; else if (resp?.sid) sent++; else suppressed++;
          } else {
            suppressed++;
          }
        }
      } catch {
        failed++;
      }

      // Advance to next step + compute new nextSendAt
      const nextIndex = idx + 1;
      const update: any = {
        $set: { cursorStep: nextIndex, processing: false, [`sentAtByIndex.${idx}`]: new Date() },
        $unset: { processingAt: 1 },
      };
      if (nextIndex >= steps.length) {
        update.$set.status = "completed";
        update.$unset.nextSendAt = 1;
        completed++;
      } else {
        const nextDay = parseDayNum(steps[nextIndex]?.day) || (parseDayNum(step.day) || 1) + 1;
        const when = computeWhenForDayPT(claim.startedAt || new Date(), nextDay);
        update.$set.nextSendAt = when;
        advanced++;
      }
      await DripEnrollment.updateOne({ _id: claim._id, cursorStep: idx }, update);
    });

    return res.status(200).json({
      ok: true,
      mode: "tick-driven",
      nowPT: DateTime.now().setZone(PT_ZONE).toISO(),
      stats: { checked, sent, scheduled, suppressed, failed, advanced, completed, inited },
    });
  } catch (e) {
    console.error("run-drips error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
