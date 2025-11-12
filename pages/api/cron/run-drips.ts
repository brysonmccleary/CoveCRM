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

export const config = { maxDuration: 60 };

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;
const PER_LEAD_CONCURRENCY =
  Math.max(1, parseInt(process.env.DRIP_CONCURRENCY || "10", 10)) || 10;

function isValidObjectId(id: string) { return /^[a-f0-9]{24}$/i.test(id); }

async function resolveDrip(dripId: string) {
  if (isValidObjectId(dripId)) return await DripCampaign.findById(dripId).lean();
  const def = prebuiltDrips.find((d) => d.id === dripId);
  if (!def) return null;
  return await DripCampaign.findOne({ isGlobal: true, name: def.name }).lean();
}

function getCanonicalDripId(dripDoc: any, fallbackId: string): string {
  return String(dripDoc?._id ? dripDoc._id : fallbackId);
}

function parseStepDayNumber(dayField?: string): number {
  if (!dayField) return NaN;
  const m = String(dayField).match(/(\d+)/); return m ? parseInt(m[1], 10) : NaN;
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

async function runBatched<T>(items: T[], batchSize: number, worker: (item: T, index: number) => Promise<void>) {
  let i = 0;
  while (i < items.length) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map((item, idx) => worker(item, i + idx)));
    i += batchSize;
  }
}

function computeStepWhenPTFromBase(base: DateTime, targetDayNumber: number, prevDayNumber = 0): DateTime {
  const delta = Math.max(0, (isNaN(targetDayNumber) ? 1 : targetDayNumber) - (isNaN(prevDayNumber) ? 0 : prevDayNumber));
  return base.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 }).plus({ days: delta });
}
function computeStepWhenPT(startedAt: Date, dayNumber: number): DateTime {
  const startPT = DateTime.fromJSDate(startedAt, { zone: PT_ZONE }).startOf("day");
  const offsetDays = Math.max(0, dayNumber - 1);
  return startPT.plus({ days: offsetDays }).set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
}
function shouldRunWindowPT(): boolean { return DateTime.now().setZone(PT_ZONE).hour === SEND_HOUR_PT; }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ---------- AUTH SHIM ----------
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("x-run-drips-auth", "bad-method");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const secret = process.env.CRON_SECRET || "";
  const queryToken = (req.query?.token as string) || "";
  const headerToken = (req.headers["x-cron-key"] as string) || "";
  const vercelCron = Boolean(req.headers["x-vercel-cron"]);

  const authorized =
    (!!secret && (queryToken === secret || headerToken === secret)) || vercelCron;

  if (!authorized) {
    res.setHeader("x-run-drips-auth", "fail");
    res.setHeader("x-run-drips-secret-len", String(secret.length));
    res.setHeader("x-run-drips-query-token-len", String(queryToken?.length || 0));
    res.setHeader("x-run-drips-header-token-len", String(headerToken?.length || 0));
    res.setHeader("cache-control", "private, no-store, max-age=0");
    return res.status(401).json({
      ok: false,
      error: "unauthorized",
      hint: "pass ?token=CRON_SECRET, or header x-cron-key: CRON_SECRET, or run from a Vercel Cron (x-vercel-cron)."
    });
  }
  res.setHeader("x-run-drips-auth", "ok");

  // ---------- ORIGINAL LOGIC ----------
  if (process.env.DRIPS_HARD_STOP === "1") return res.status(204).end();

  const force = ["1","true","yes"].includes(String(req.query.force || "").toLowerCase());
  const dry   = ["1","true","yes"].includes(String(req.query.dry   || "").toLowerCase());
  const limit = Math.max(0, parseInt((req.query.limit as string) || "", 10) || 0);

  try {
    await dbConnect();

    const cronLockOk = await acquireLock("cron", "run-drips", 50);
    if (!cronLockOk && !force) return res.status(200).json({ message: "Already running, skipping this tick." });

    const dueCount = await DripEnrollment.countDocuments({
      status: "active",
      nextSendAt: { $lte: new Date() },
      $and: [
        { $or: [{ active: { $ne: false } }, { isActive: true }, { enabled: true }] },
        { $or: [{ paused: { $ne: true } }, { isPaused: { $ne: true } }] },
        { stopAll: { $ne: true } },
      ],
    });

    const windowOK = force || process.env.DRIPS_DEBUG_ALWAYS_RUN === "1" || dueCount > 0 || shouldRunWindowPT();
    if (!windowOK) {
      return res.status(200).json({
        message: "Not run window (expects 9:00 AM PT). Set DRIPS_DEBUG_ALWAYS_RUN=1 or ?force=1 to override.",
        nowPT: DateTime.now().setZone(PT_ZONE).toISO(),
        dueEnrollments: dueCount,
      });
    }

    const nowPT = DateTime.now().setZone(PT_ZONE);
    console.log(`🕘 run-drips start @ ${nowPT.toISO()} PT | force=${force} dry=${dry} limit=${limit || "∞"} due=${dueCount}`);

    // -------- PRIMARY: ENROLLMENT ENGINE (with idempotency markers) --------
    let enrollChecked = 0, enrollSent = 0, enrollScheduled = 0, enrollSuppressed = 0, enrollFailed = 0, enrollCompleted = 0, enrollClaimMiss = 0, enrollAlreadySent = 0;

    const dueEnrollmentsQ = DripEnrollment.find({
      status: "active",
      nextSendAt: { $lte: new Date() },
      $and: [
        { $or: [{ active: { $ne: false } }, { isActive: true }, { enabled: true }] },
        { $or: [{ paused: { $ne: true } }, { isPaused: { $ne: true } }] },
        { stopAll: { $ne: true } },
      ],
    }).select({ _id: 1, leadId: 1, campaignId: 1, userEmail: 1, cursorStep: 1, nextSendAt: 1, sentAtByIndex: 1 }).lean();

    const dueEnrollments = limit > 0 ? await dueEnrollmentsQ.limit(limit) : await dueEnrollmentsQ;

    await runBatched(dueEnrollments, PER_LEAD_CONCURRENCY, async (enr) => {
      enrollChecked++;

      // Atomic claim
      const claim = await DripEnrollment.findOneAndUpdate(
        {
          _id: enr._id,
          status: "active",
          nextSendAt: { $lte: new Date() },
          cursorStep: enr.cursorStep ?? 0,
          $and: [
            { $or: [{ active: { $ne: false } }, { isActive: true }, { enabled: true }] },
            { $or: [{ paused: { $ne: true } }, { isPaused: { $ne: true } }] },
            { stopAll: { $ne: true } },
          ],
        },
        { $set: { processing: true, processingAt: new Date() } },
        { new: true }
      ).lean();
      if (!claim) { enrollClaimMiss++; return; }

      const [lead, user, campaign] = await Promise.all([
        Lead.findById(claim.leadId).select({ _id: 1, Phone: 1, "First Name": 1, "Last Name": 1, userEmail: 1 }).lean(),
        User.findOne({ email: claim.userEmail }).select({ _id: 1, email: 1, name: 1 }).lean(),
        DripCampaign.findById(claim.campaignId).select({ _id: 1, name: 1, type: 1, isActive: 1, steps: 1 }).lean() as any,
      ]);

      if (!lead || !user?._id || !campaign || (campaign as any).isActive !== true || (campaign as any).type !== "sms") {
        await DripEnrollment.updateOne({ _id: claim._id }, { $set: { processing: false }, $unset: { processingAt: 1 } });
        return;
      }

      const to = normalizeToE164Maybe((lead as any).Phone);
      if (!to) {
        await DripEnrollment.updateOne({ _id: claim._id }, { $set: { processing: false }, $unset: { processingAt: 1 } });
        return;
      }

      const { first: agentFirst, last: agentLast } = splitName(user.name || "");
      const firstName = (lead as any)["First Name"] || null;
      const lastName  = (lead as any)["Last Name"]  || null;
      const fullName  = [firstName, lastName].filter(Boolean).join(" ") || null;
      const agentCtx  = { name: user.name || null, first_name: agentFirst, last_name: agentLast };

      const steps: Array<{ text?: string; day?: string }> = Array.isArray((campaign as any).steps) ? (campaign as any).steps : [];
      const idx = Math.max(0, Number(claim.cursorStep || 0));
      const step = steps[idx];

      if (!step) {
        await DripEnrollment.updateOne(
          { _id: claim._id },
          { $set: { status: "completed", processing: false }, $unset: { nextSendAt: 1, processingAt: 1 } }
        );
        enrollCompleted++;
        return;
      }

      // --- Durable once-only: skip if this step already marked sent ---
      const alreadySent = (claim as any)?.sentAtByIndex && (claim as any).sentAtByIndex.get?.(String(idx));
      if (alreadySent) {
        // Advance cursor without sending again.
        const nextIndex = idx + 1;
        const update: any = { $set: { cursorStep: nextIndex, processing: false }, $unset: { processingAt: 1 } };
        if (nextIndex >= steps.length) {
          update.$set.status = "completed";
          update.$unset = { ...(update.$unset || {}), nextSendAt: 1 };
        } else {
          const prevDay = parseStepDayNumber(step.day);
          const nextDay = parseStepDayNumber(steps[nextIndex].day);
          const base = DateTime.now().setZone(PT_ZONE).startOf("day");
          const nextWhen = computeStepWhenPTFromBase(base, nextDay, prevDay);
          update.$set.nextSendAt = nextWhen.toJSDate();
          update.$set.lastSentAt = new Date();
        }
        await DripEnrollment.updateOne({ _id: claim._id, cursorStep: idx }, update);
        enrollAlreadySent++;
        return;
      }

      const rendered = renderTemplate(String(step.text || ""), {
        contact: { first_name: firstName, last_name: lastName, full_name: fullName },
        agent: agentCtx,
      });
      const finalBody = ensureOptOut(rendered);

      // Idempotency key (transport-level)
      const idKey = `${String(claim._id)}:${idx}:${new Date(claim.nextSendAt || Date.now()).toISOString()}`;

      // --- Double-check "still active" right before send (remove correctness) ---
      const fresh = await DripEnrollment.findById(claim._id).select({ status: 1, stopAll: 1, paused: 1, isPaused: 1 }).lean();
      if (!fresh || fresh.status !== "active" || fresh.stopAll === true || fresh.paused === true || fresh.isPaused === true) {
        // Someone canceled or paused during processing—bail without sending.
        await DripEnrollment.updateOne({ _id: claim._id }, { $set: { processing: false }, $unset: { processingAt: 1 } });
        return;
      }

      // ⭐ Minimal TS narrow to satisfy _id access (no logic change)
      const leadDoc: any = Array.isArray(lead) ? lead[0] : lead;
      const campaignDoc: any = Array.isArray(campaign) ? campaign[0] : campaign;

      try {
        if (!dry) {
          const ok = await acquireLock(
            "enroll",
            `${String(user.email)}:${String(leadDoc?._id)}:${String(campaignDoc?._id)}:${String(idx)}`,
            600
          );
          if (ok) {
            const result = await sendSms({
              to,
              body: finalBody,
              userEmail: user.email,
              leadId: String(leadDoc?._id),
              idempotencyKey: idKey,
              enrollmentId: String(claim._id),
              campaignId: String(campaignDoc?._id),
              stepIndex: idx,
            });
            if (result?.scheduledAt) enrollScheduled++;
            else if (result?.sid)   enrollSent++;
            else                    enrollSuppressed++;
          } else {
            enrollSuppressed++;
          }
        }
      } catch {
        enrollFailed++;
      }

      const nextIndex = idx + 1;
      const update: any = {
        $set: {
          cursorStep: nextIndex,
          processing: false,
          [`sentAtByIndex.${idx}`]: new Date(), // <-- durable once-only marker
        },
        $unset: { processingAt: 1 },
      };
      if (nextIndex >= steps.length) {
        update.$set.status = "completed";
        update.$unset = { ...(update.$unset || {}), nextSendAt: 1 };
      } else {
        const prevDay = parseStepDayNumber(step.day);
        const nextDay = parseStepDayNumber(steps[nextIndex].day);
        const base = DateTime.now().setZone(PT_ZONE).startOf("day");
        const nextWhen = computeStepWhenPTFromBase(base, nextDay, prevDay);
        update.$set.nextSendAt = nextWhen.toJSDate();
        update.$set.lastSentAt = new Date();
      }
      await DripEnrollment.updateOne({ _id: claim._id, cursorStep: idx }, update);
    });

    // -------- LEGACY BLOCK (kept but gated) --------
    const legacyEnabled = process.env.DRIPS_LEGACY_ENABLED === "1";
    let checked = 0, candidates = 0, accepted = 0, scheduled = 0, suppressed = 0, failed = 0;
    let initializedProgress = 0, wouldInitProgress = 0;

    if (legacyEnabled) {
      const legacyAllowed = force || process.env.DRIPS_DEBUG_ALWAYS_RUN === "1" || shouldRunWindowPT();

      if (legacyAllowed) {
        const nowPT2 = DateTime.now().setZone(PT_ZONE);
        const leadsQ = Lead.find({
          $and: [
            { unsubscribed: { $ne: true } },
            { optOut: { $ne: true } },
            { assignedDrips: { $exists: true, $ne: [] } },
          ],
        }).select({ _id: 1, userEmail: 1, Phone: 1, "First Name": 1, "Last Name": 1, assignedDrips: 1, dripProgress: 1 }).lean();

        const leads = limit > 0 ? await leadsQ.limit(limit) : await leadsQ;
        // (INTACT) — legacy loop content remains unchanged ...
        await runBatched(leads, PER_LEAD_CONCURRENCY, async (lead) => {
          checked++;
          const to = normalizeToE164Maybe((lead as any).Phone);
          if (!to) return;

          const user = await User.findOne({ email: (lead as any).userEmail }).select({ _id: 1, email: 1, name: 1 }).lean();
          if (!user?._id) return;

          const { first: agentFirst, last: agentLast } = splitName(user.name || "");
          const agentCtx = { name: user.name || null, first_name: agentFirst, last_name: agentLast };
          const firstName = (lead as any)["First Name"] || null;
          const lastName  = (lead as any)["Last Name"]  || null;
          const fullName  = [firstName, lastName].filter(Boolean).join(" ") || null;

          const assigned: string[] = Array.isArray((lead as any).assignedDrips) ? (lead as any).assignedDrips : [];
          const progressArr: any[] = Array.isArray((lead as any).dripProgress) ? (lead as any).dripProgress : [];
          if (!assigned.length) return;

          for (const dripId of assigned) {
            const dripDoc: any = await resolveDrip(dripId);
            if (!dripDoc || dripDoc.type !== "sms") continue;
            const campaignId = getCanonicalDripId(dripDoc, String(dripId));

            const steps: Array<{ text?: string; day?: string }> = (() => {
              const arr = Array.isArray(dripDoc?.steps) ? dripDoc.steps : [];
              if (arr.some((s: any) => s?.day)) {
                return arr.filter((s: any) => !isNaN(parseStepDayNumber(s?.day)))
                          .sort((a: any, b: any) => parseStepDayNumber(a?.day) - parseStepDayNumber(b?.day));
              }
              return arr;
            })();
            if (!steps.length) continue;

            let prog = progressArr.find((p) => String(p.dripId) === String(campaignId)) ||
                       progressArr.find((p) => String(p.dripId) === String(dripId));

            if (!prog || !prog.startedAt) {
              if (dry) { wouldInitProgress++; prog = { dripId: String(campaignId), startedAt: new Date(), lastSentIndex: -1 } as any; }
              else {
                const init = { dripId: String(campaignId), startedAt: new Date(), lastSentIndex: -1 };
                await Lead.updateOne({ _id: (lead as any)._id, "dripProgress.dripId": { $ne: String(campaignId) } }, { $push: { dripProgress: init } });
                initializedProgress++; prog = init as any; progressArr.push(prog);
              }
            }

            let nextIndex = (typeof prog.lastSentIndex === "number" ? prog.lastSentIndex : -1) + 1;
            if (nextIndex >= steps.length) continue;

            while (true) {
              if (nextIndex >= steps.length) break;
              const step = steps[nextIndex];
              const dayNum = parseStepDayNumber(step.day);
              const duePT  = !isNaN(dayNum) ? computeStepWhenPT(new Date(prog.startedAt), dayNum) : nowPT2;
              if (DateTime.now().setZone(PT_ZONE) < duePT) break;

              candidates++;
              const rendered = renderTemplate(String(step.text || ""), { contact: { first_name: firstName, last_name: lastName, full_name: fullName }, agent: agentCtx });
              const finalBody = ensureOptOut(rendered);

              if (dry) { nextIndex++; continue; }

              try {
                const stepKey = String(step?.day ?? nextIndex);
                const ok = await acquireLock("drip", `${String(user.email)}:${String((lead as any)._id)}:${String(campaignId)}:${stepKey}`, 600);
                if (!ok) break;

                const idKey = `legacy:${String(lead._id)}:${String(campaignId)}:${nextIndex}`;
                const result = await sendSms({ to, body: finalBody, userEmail: user.email, leadId: String((lead as any)._id),
                  idempotencyKey: idKey, campaignId: String(campaignId), stepIndex: nextIndex });

                if (result?.scheduledAt) scheduled++; else if (result?.sid) accepted++; else suppressed++;

                await Lead.updateOne({ _id: (lead as any)._id, "dripProgress.dripId": String(campaignId) }, { $set: { "dripProgress.$.lastSentIndex": nextIndex } });
                nextIndex++;
              } catch { failed++; break; }
            }
          }
        });
      }
    }

    return res.status(200).json({
      message: "run-drips complete",
      nowPT: DateTime.now().setZone(PT_ZONE).toISO(),
      forced: force, dryRun: dry, limit,
    });
  } catch (error) {
    console.error("❌ run-drips error:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
