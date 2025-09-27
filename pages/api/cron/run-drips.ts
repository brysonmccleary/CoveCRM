// /pages/api/cron/run-drips.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";
import DripCampaign from "@/models/DripCampaign";
import DripEnrollment from "@/models/DripEnrollment";
import { sendSms } from "@/lib/twilio/sendSMS";
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import { DateTime } from "luxon";
import { acquireLock } from "@/lib/locks";

// Increase Serverless time budget
export const config = { maxDuration: 60 };

// --- Config ---
const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;
const PER_LEAD_CONCURRENCY =
  Math.max(1, parseInt(process.env.DRIP_CONCURRENCY || "10", 10)) || 10;

// --- Helpers ---
function isValidObjectId(id: string) {
  return /^[a-f0-9]{24}$/i.test(id);
}

async function resolveDrip(dripId: string) {
  if (isValidObjectId(dripId)) {
    return await DripCampaign.findById(dripId).lean();
  }
  const def = prebuiltDrips.find((d) => d.id === dripId);
  if (!def) return null;
  return await DripCampaign.findOne({ isGlobal: true, name: def.name }).lean();
}

function getCanonicalDripId(dripDoc: any, fallbackId: string): string {
  return String(dripDoc?._id ? dripDoc._id : fallbackId);
}

function parseStepDayNumber(dayField?: string): number {
  if (!dayField) return NaN;
  const m = String(dayField).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

function normalizeToE164Maybe(phone?: string): string | null {
  if (!phone) return null;
  const digits = (phone || "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  const just = digits.replace(/\D/g, "");
  if (just.length === 10) return `+1${just}`;
  if (just.length === 11 && just.startsWith("1")) return `+${just}`;
  return null;
}

async function runBatched<T>(
  items: T[],
  batchSize: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let i = 0;
  while (i < items.length) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map((item, idx) => worker(item, i + idx)));
    i += batchSize;
  }
}

function computeStepWhenPTFromBase(base: DateTime, targetDayNumber: number, prevDayNumber = 0): DateTime {
  const delta = Math.max(
    0,
    (isNaN(targetDayNumber) ? 1 : targetDayNumber) -
      (isNaN(prevDayNumber) ? 0 : prevDayNumber),
  );
  return base.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 }).plus({ days: delta });
}

function computeStepWhenPT(startedAt: Date, dayNumber: number): DateTime {
  const startPT = DateTime.fromJSDate(startedAt, { zone: PT_ZONE }).startOf("day");
  const offsetDays = Math.max(0, dayNumber - 1);
  return startPT
    .plus({ days: offsetDays })
    .set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
}

function shouldRunNowPT(force: boolean): boolean {
  if (force || process.env.DRIPS_DEBUG_ALWAYS_RUN === "1") return true;
  const nowPT = DateTime.now().setZone(PT_ZONE);
  return nowPT.hour === SEND_HOUR_PT;
}

type DripCounters = {
  considered: number;
  sentAccepted: number;
  scheduled: number;
  suppressed: number;
  failed: number;
};

type SkipMap = Record<string, number>;
function bump(map: SkipMap, key: string) { map[key] = (map[key] || 0) + 1; }

// --- Handler ---
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const force = ["1", "true", "yes"].includes(String(req.query.force || "").toLowerCase());
  const dry   = ["1", "true", "yes"].includes(String(req.query.dry   || "").toLowerCase());
  const limit = Math.max(0, parseInt((req.query.limit as string) || "", 10) || 0);

  if (!shouldRunNowPT(force)) {
    return res.status(200).json({
      message:
        "Not run window (expects 9:00 AM PT). Set DRIPS_DEBUG_ALWAYS_RUN=1 or ?force=1 to override.",
      nowPT: DateTime.now().setZone(PT_ZONE).toISO(),
    });
  }

  try {
    await dbConnect();

    const nowPT = DateTime.now().setZone(PT_ZONE);
    console.log(`🕘 run-drips start @ ${nowPT.toISO()} PT | force=${force} dry=${dry} limit=${limit || "∞"}`);

    // ------------------------------------------------------------
    // 1) Per-Lead DripEnrollment (manual-lead) block
    // ------------------------------------------------------------
    let enrollChecked = 0, enrollSent = 0, enrollScheduled = 0, enrollSuppressed = 0, enrollFailed = 0, enrollCompleted = 0;

    const dueEnrollmentsQ = DripEnrollment.find({
      status: "active",
      nextSendAt: { $lte: new Date() },
    })
      .select({ _id: 1, leadId: 1, campaignId: 1, userEmail: 1, cursorStep: 1, nextSendAt: 1 })
      .lean();

    const dueEnrollments = limit > 0 ? await dueEnrollmentsQ.limit(limit) : await dueEnrollmentsQ;

    await runBatched(dueEnrollments, PER_LEAD_CONCURRENCY, async (enr) => {
      enrollChecked++;

      const [lead, user, campaign] = await Promise.all([
        Lead.findById(enr.leadId).select({ _id: 1, Phone: 1, "First Name": 1, "Last Name": 1, userEmail: 1 }).lean(),
        User.findOne({ email: enr.userEmail }).select({ _id: 1, email: 1, name: 1 }).lean(),
        DripCampaign.findById(enr.campaignId).select({ _id: 1, name: 1, type: 1, isActive: 1, steps: 1 }).lean() as any,
      ]);

      if (!lead) return;
      if (!user?._id) return;
      if (!campaign || (campaign as any).isActive !== true || (campaign as any).type !== "sms") return;

      const to = normalizeToE164Maybe((lead as any).Phone);
      if (!to) return;

      const { first: agentFirst, last: agentLast } = splitName(user.name || "");
      const firstName = (lead as any)["First Name"] || null;
      const lastName  = (lead as any)["Last Name"]  || null;
      const fullName  = [firstName, lastName].filter(Boolean).join(" ") || null;
      const agentCtx  = { name: user.name || null, first_name: agentFirst, last_name: agentLast };

      const steps: Array<{ text?: string; day?: string }> =
        Array.isArray((campaign as any).steps) ? (campaign as any).steps : [];
      const idx = Math.max(0, Number(enr.cursorStep || 0));
      const step = steps[idx];

      if (!step) {
        await DripEnrollment.updateOne({ _id: (enr as any)._id }, { $set: { status: "completed" }, $unset: { nextSendAt: 1 } });
        enrollCompleted++;
        return;
      }

      const rendered = renderTemplate(String(step.text || ""), {
        contact: { first_name: firstName, last_name: lastName, full_name: fullName },
        agent: agentCtx,
      });
      const finalBody = ensureOptOut(rendered);

      if (!dry) {
        try {
          const ok = await acquireLock(
            "enroll",
            `${String(user.email)}:${String((lead as any)._id)}:${String((campaign as any)._id)}:${String(idx)}`,
            600
          );
          if (!ok) return;

          const result = await sendSms({ to, body: finalBody, userEmail: user.email, leadId: String((lead as any)._id) });
          if (result.sid) {
            if (result.scheduledAt) enrollScheduled++; else enrollSent++;
          } else {
            enrollSuppressed++;
          }
        } catch {
          enrollFailed++;
          return;
        }
      }

      // advance
      const nextIndex = idx + 1;
      const update: any = { $set: { cursorStep: nextIndex } };

      if (nextIndex >= steps.length) {
        update.$set.status = "completed";
        update.$unset = { ...(update.$unset || {}), nextSendAt: 1 };
      } else {
        const prevDay = parseStepDayNumber(step.day);
        const nextDay = parseStepDayNumber(steps[nextIndex].day);
        const base = DateTime.now().setZone(PT_ZONE).startOf("day");
        const nextWhen = computeStepWhenPTFromBase(base, nextDay, prevDay);
        update.$set.nextSendAt = nextWhen.toJSDate();
      }

      await DripEnrollment.updateOne({ _id: (enr as any)._id }, update);
    });

    console.log(`📦 enroll: checked=${enrollChecked} ✅sent=${enrollSent} 🕘scheduled=${enrollScheduled} ⚠️suppressed=${enrollSuppressed} ❌failed=${enrollFailed} 🏁completed=${enrollCompleted}`);

    // ------------------------------------------------------------
    // 2) Legacy assignedDrips + dripProgress block (unchanged)
    // ------------------------------------------------------------
    const nowPT2 = DateTime.now().setZone(PT_ZONE);

    const leadQuery: any = {
      $and: [
        { unsubscribed: { $ne: true } },
        { optOut: { $ne: true } },
        { assignedDrips: { $exists: true, $ne: [] } },
      ],
    };

    const leadsQ = Lead.find(leadQuery)
      .select({ _id: 1, userEmail: 1, Phone: 1, "First Name": 1, "Last Name": 1, assignedDrips: 1, dripProgress: 1 })
      .lean();

    const leads = limit > 0 ? await leadsQ.limit(limit) : await leadsQ;
    console.log(`📋 Leads eligible: ${leads.length}`);

    let checked = 0, candidates = 0, accepted = 0, scheduled = 0, suppressed = 0, failed = 0;
    let initializedProgress = 0, wouldInitProgress = 0;

    const skippedByReason: SkipMap = {};
    const perDripCounters = new Map<string, DripCounters>();

    function bumpDrip(dripId: string, key: keyof DripCounters) {
      const c = perDripCounters.get(dripId) || { considered: 0, sentAccepted: 0, scheduled: 0, suppressed: 0, failed: 0 };
      c[key] = (c[key] as number) + 1;
      perDripCounters.set(dripId, c);
    }

    await runBatched(leads, PER_LEAD_CONCURRENCY, async (lead) => {
      checked++;

      const to = normalizeToE164Maybe((lead as any).Phone);
      if (!to) { bump(skippedByReason, "invalidPhone"); return; }

      const user = await User.findOne({ email: (lead as any).userEmail })
        .select({ _id: 1, email: 1, name: 1 })
        .lean();
      if (!user?._id) { bump(skippedByReason, "userMissing"); return; }

      const { first: agentFirst, last: agentLast } = splitName(user.name || "");
      const agentCtx = { name: user.name || null, first_name: agentFirst, last_name: agentLast };

      const firstName = (lead as any)["First Name"] || null;
      const lastName  = (lead as any)["Last Name"]  || null;
      const fullName  = [firstName, lastName].filter(Boolean).join(" ") || null;

      const assigned: string[] = Array.isArray((lead as any).assignedDrips) ? (lead as any).assignedDrips : [];
      const progressArr: any[] = Array.isArray((lead as any).dripProgress) ? (lead as any).dripProgress : [];

      if (!assigned.length) { bump(skippedByReason, "noAssignedDrips"); return; }

      for (const dripId of assigned) {
        const dripDoc: any = await resolveDrip(dripId);
        if (!dripDoc) { bump(skippedByReason, "dripMissing"); continue; }
        if (dripDoc.type !== "sms") { bump(skippedByReason, "dripNotSms"); continue; }

        const campaignId = getCanonicalDripId(dripDoc, String(dripId));

        const steps: Array<{ text?: string; day?: string }> = (() => {
          const arr = Array.isArray(dripDoc?.steps) ? dripDoc.steps : [];
          if (arr.some((s: any) => s?.day)) {
            return arr
              .filter((s: any) => !isNaN(parseStepDayNumber(s?.day)))
              .sort((a: any, b: any) => parseStepDayNumber(a?.day) - parseStepDayNumber(b?.day));
          }
          return arr;
        })();

        if (!steps.length) { bump(skippedByReason, "noSteps"); continue; }

        let prog =
          progressArr.find((p) => String(p.dripId) === String(campaignId)) ||
          progressArr.find((p) => String(p.dripId) === String(dripId));

        if (!prog || !prog.startedAt) {
          if (dry) {
            wouldInitProgress++;
            prog = { dripId: String(campaignId), startedAt: DateTime.now().setZone(PT_ZONE).toJSDate(), lastSentIndex: -1 } as any;
          } else {
            const init = { dripId: String(campaignId), startedAt: new Date(), lastSentIndex: -1 };
            await Lead.updateOne(
              { _id: (lead as any)._id, "dripProgress.dripId": { $ne: String(campaignId) } },
              { $push: { dripProgress: init } },
            );
            initializedProgress++;
            prog = init as any;
            progressArr.push(prog);
          }
        }

        let nextIndex = (typeof prog.lastSentIndex === "number" ? prog.lastSentIndex : -1) + 1;
        if (nextIndex >= steps.length) { bump(skippedByReason, "completed"); continue; }

        let advancedAtLeastOne = false;

        while (true) {
          if (nextIndex >= steps.length) break;

          const step = steps[nextIndex];
          const dayNum = parseStepDayNumber(step.day);
          const duePT  = !isNaN(dayNum) ? computeStepWhenPT(new Date(prog.startedAt), dayNum) : nowPT2;

          const nowPTlocal = DateTime.now().setZone(PT_ZONE);
          if (nowPTlocal < duePT) { bump(skippedByReason, "notDue"); break; }

          const raw = String(step.text || "");
          const lower = raw.trim().toLowerCase();
          const optOutKeywords = ["stop", "unsubscribe", "end", "quit", "cancel"];
          if (optOutKeywords.includes(lower)) { bump(skippedByReason, "optoutKeywordStep"); nextIndex++; continue; }

          candidates++;
          bumpDrip(String(campaignId), "considered");

          const rendered = renderTemplate(raw, { contact: { first_name: firstName, last_name: lastName, full_name: fullName }, agent: agentCtx });
          const finalBody = ensureOptOut(rendered);

          if (dry) { nextIndex++; advancedAtLeastOne = true; continue; }

          try {
            const stepKey = String(step?.day ?? nextIndex);
            const ok = await acquireLock("drip", `${String(user.email)}:${String((lead as any)._id)}:${String(campaignId)}:${stepKey}`, 600);
            if (!ok) break;

            const result = await sendSms({ to, body: finalBody, userEmail: user.email, leadId: String((lead as any)._id) });

            if (result.sid) {
              if (result.scheduledAt) { scheduled++; bumpDrip(String(campaignId), "scheduled"); }
              else { accepted++; bumpDrip(String(campaignId), "sentAccepted"); }
            } else { suppressed++; bumpDrip(String(campaignId), "suppressed"); }

            await Lead.updateOne(
              { _id: (lead as any)._id, "dripProgress.dripId": String(campaignId) },
              { $set: { "dripProgress.$.lastSentIndex": nextIndex } },
            );

            nextIndex++;
            advancedAtLeastOne = true;
          } catch {
            failed++;
            bumpDrip(String(campaignId), "failed");
            break;
          }
        }

        if (!advancedAtLeastOne && nextIndex < steps.length) {
          // not due yet
        }
      }
    });

    // Build per-campaign summary
    const perCampaign: Record<string, DripCounters & { id: string }> = {};
    for (const [id, c] of perDripCounters.entries()) {
      perCampaign[id] = { id, ...c };
      console.log(`🧾 drip=${id} considered=${c.considered} ✅=${c.sentAccepted} 🕘=${c.scheduled} ⚠️=${c.suppressed} ❌=${c.failed}`);
    }

    console.log(
      `🏁 run-drips done checked=${checked} candidates=${candidates} ✅accepted=${accepted} 🕘scheduled=${scheduled} ⚠️suppressed=${suppressed} ❌failed=${failed} 🧩init=${initializedProgress} (would=${wouldInitProgress})`,
    );

    // ✅ FINAL RESPONSE — prevents 504
    return res.status(200).json({
      message: "run-drips complete",
      nowPT: DateTime.now().setZone(PT_ZONE).toISO(),
      forced: force,
      dryRun: dry,
      limit,
      enrollSummary: {
        checked: enrollChecked,
        sent: enrollSent,
        scheduled: enrollScheduled,
        suppressed: enrollSuppressed,
        failed: enrollFailed,
        completed: enrollCompleted,
      },
      legacySummary: {
        leadsChecked: checked,
        candidates,
        accepted,
        scheduled,
        suppressed,
        failed,
        initializedProgress,
        wouldInitProgress,
        perCampaign,
      },
    });
  } catch (error) {
    console.error("❌ run-drips error:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
