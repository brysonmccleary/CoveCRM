// /pages/api/cron/run-drips.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";
import DripCampaign from "@/models/DripCampaign";
import { sendSms } from "@/lib/twilio/sendSMS";
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import { DateTime } from "luxon";

// --- Config ---
const PT_ZONE = "America/Los_Angeles"; // 9:00 AM Pacific
const SEND_HOUR_PT = 9;

// Concurrency for per-lead processing
const PER_LEAD_CONCURRENCY =
  Math.max(1, parseInt(process.env.DRIP_CONCURRENCY || "10", 10)) || 10;

// --- Helpers ---
function isValidObjectId(id: string) {
  return /^[a-f0-9]{24}$/i.test(id);
}

/** Resolve a drip by Mongo _id or a prebuilt slug (maps to global campaign by name). */
async function resolveDrip(dripId: string) {
  if (isValidObjectId(dripId)) {
    return await DripCampaign.findById(dripId).lean();
  }
  const def = prebuiltDrips.find((d) => d.id === dripId);
  if (!def) return null;
  return await DripCampaign.findOne({ isGlobal: true, name: def.name }).lean();
}

/** Extract the first integer found in a string like "Day 7" -> 7. Returns NaN if none. */
function parseStepDayNumber(dayField?: string): number {
  if (!dayField) return NaN;
  const m = String(dayField).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

/** Normalize to +E.164 if possible. Returns null when invalid. */
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

/** Return steps sorted by numeric Day ascending; filters out non-day steps. */
function sortDaySteps(drip: any): Array<{ text: string; day: string }> {
  const steps: Array<{ text: string; day: string }> = Array.isArray(drip?.steps)
    ? drip.steps
    : [];
  const daySteps = steps.filter((s) => !isNaN(parseStepDayNumber(s?.day)));
  return [...daySteps].sort(
    (a, b) => parseStepDayNumber(a?.day) - parseStepDayNumber(b?.day),
  );
}

/** Compute the scheduled DateTime in PT for a given step day number and startedAt. */
function computeStepWhenPT(startedAt: Date, dayNumber: number): DateTime {
  const startPT = DateTime.fromJSDate(startedAt, { zone: PT_ZONE }).startOf("day");
  const offsetDays = Math.max(0, dayNumber - 1); // Day 1 => +0 days
  return startPT
    .plus({ days: offsetDays })
    .set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
}

/** Guard: only operate when now is 9AM PT (unless DRIPS_DEBUG_ALWAYS_RUN=1 or ?force=1) */
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

function bump(map: SkipMap, key: string) {
  map[key] = (map[key] || 0) + 1;
}

// --- Handler ---
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  const force =
    req.query.force === "1" ||
    req.query.force === "true" ||
    req.query.force === "yes";
  const dry =
    req.query.dry === "1" || req.query.dry === "true" || req.query.dry === "yes";
  const limit = Math.max(
    0,
    parseInt((req.query.limit as string) || "", 10) || 0,
  );

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

    // Fetch leads with assigned drips; DO NOT require dripProgress here (we'll auto-init it)
    const leadQuery: any = {
      $and: [
        { unsubscribed: { $ne: true } },
        { optOut: { $ne: true } }, // extra guard; sendSms will also suppress
        { assignedDrips: { $exists: true, $ne: [] } },
      ],
    };

    const leadsQ = Lead.find(leadQuery)
      .select({
        _id: 1,
        userEmail: 1,
        Phone: 1,
        "First Name": 1,
        "Last Name": 1,
        assignedDrips: 1,
        dripProgress: 1,
      })
      .lean();

    const leads = limit > 0 ? await leadsQ.limit(limit) : await leadsQ;
    console.log(`📋 Leads eligible: ${leads.length}`);

    let checked = 0;
    let candidates = 0;
    let accepted = 0;
    let scheduled = 0;
    let suppressed = 0;
    let failed = 0;
    let initializedProgress = 0;
    let wouldInitProgress = 0;

    const skippedByReason: SkipMap = {};
    const perDripCounters = new Map<string, DripCounters>();

    function bumpDrip(dripId: string, key: keyof DripCounters) {
      const c =
        perDripCounters.get(dripId) || {
          considered: 0,
          sentAccepted: 0,
          scheduled: 0,
          suppressed: 0,
          failed: 0,
        };
      c[key] = (c[key] as number) + 1;
      perDripCounters.set(dripId, c);
    }

    const sentSample: any[] = [];
    const skippedSample: any[] = [];

    await runBatched(leads, PER_LEAD_CONCURRENCY, async (lead) => {
      checked++;

      const to = normalizeToE164Maybe((lead as any).Phone);
      if (!to) {
        bump(skippedByReason, "invalidPhone");
        if (skippedSample.length < 10) skippedSample.push({ leadId: String((lead as any)._id), reason: "invalidPhone" });
        return;
      }

      // Lookup agent/user for rendering context + A2P gating
      const user = await User.findOne({ email: (lead as any).userEmail })
        .select({ _id: 1, email: 1, name: 1 })
        .lean();
      if (!user?._id) {
        bump(skippedByReason, "userMissing");
        if (skippedSample.length < 10) skippedSample.push({ leadId: String((lead as any)._id), reason: "userMissing" });
        return;
      }

      const { first: agentFirst, last: agentLast } = splitName(user.name || "");
      const agentCtx = {
        name: user.name || null,
        first_name: agentFirst,
        last_name: agentLast,
      };

      const firstName = (lead as any)["First Name"] || null;
      const lastName = (lead as any)["Last Name"] || null;
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

      const assigned: string[] = Array.isArray((lead as any).assignedDrips)
        ? (lead as any).assignedDrips
        : [];
      const progressArr: any[] = Array.isArray((lead as any).dripProgress)
        ? (lead as any).dripProgress
        : [];

      if (!assigned.length) {
        bump(skippedByReason, "noAssignedDrips");
        if (skippedSample.length < 10) skippedSample.push({ leadId: String((lead as any)._id), reason: "noAssignedDrips" });
        return;
      }

      for (const dripId of assigned) {
        // Resolve drip definition
        const dripDoc: any = await resolveDrip(dripId);
        if (!dripDoc) {
          bump(skippedByReason, "dripMissing");
          if (skippedSample.length < 10)
            skippedSample.push({ leadId: String((lead as any)._id), dripId: String(dripId), reason: "dripMissing" });
          continue;
        }
        if (dripDoc.type !== "sms") {
          bump(skippedByReason, "dripNotSms");
          continue;
        }

        const steps = sortDaySteps(dripDoc);
        if (!steps.length) {
          bump(skippedByReason, "noSteps");
          continue;
        }

        // Find progress for this drip; if missing, initialize
        let prog = progressArr.find((p) => String(p.dripId) === String(dripId));

        if (!prog || !prog.startedAt) {
          if (dry) {
            wouldInitProgress++;
            // Simulate as if started now, so Day 1 is considered
            prog = {
              dripId: String(dripId),
              startedAt: DateTime.now().setZone(PT_ZONE).toJSDate(),
              lastSentIndex: -1,
              _simulated: true,
            };
          } else {
            const init = {
              dripId: String(dripId),
              startedAt: new Date(),
              lastSentIndex: -1,
            };
            await Lead.updateOne(
              { _id: (lead as any)._id, "dripProgress.dripId": { $ne: String(dripId) } },
              { $push: { dripProgress: init } },
            );
            initializedProgress++;
            // Reflect locally so this run proceeds to send Day 1
            prog = init as any;
            progressArr.push(prog);
          }
        }

        let nextIndex =
          (typeof prog.lastSentIndex === "number" ? prog.lastSentIndex : -1) + 1;

        if (nextIndex >= steps.length) {
          bump(skippedByReason, "completed");
          continue;
        }

        // Sequentially catch-up any missed steps (still at 9am PT gate)
        let advancedAtLeastOne = false;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (nextIndex >= steps.length) break;

          const step = steps[nextIndex];
          const dayNum = parseStepDayNumber(step.day);
          if (isNaN(dayNum)) break;

          const duePT = computeStepWhenPT(new Date(prog.startedAt), dayNum);
          const nowPTlocal = DateTime.now().setZone(PT_ZONE);

          if (nowPTlocal < duePT) {
            bump(skippedByReason, "notDue");
            if (skippedSample.length < 10)
              skippedSample.push({
                leadId: String((lead as any)._id),
                dripId: String(dripId),
                reason: "notDue",
                step: step.day,
                duePT: duePT.toISO(),
              });
            break; // future step; stop for this drip
          }

          // Safety: don't send raw opt-out keywords as a message
          const raw = String(step.text || "");
          const lower = raw.trim().toLowerCase();
          const optOutKeywords = ["stop", "unsubscribe", "end", "quit", "cancel"];
          if (optOutKeywords.includes(lower)) {
            bump(skippedByReason, "optoutKeywordStep");
            nextIndex++;
            continue;
          }

          // Candidate is due now or in the past → we will send (or dry-run)
          candidates++;
          bumpDrip(String(dripId), "considered");

          const rendered = renderTemplate(raw, {
            contact: { first_name: firstName, last_name: lastName, full_name: fullName },
            agent: agentCtx,
          });
          const finalBody = ensureOptOut(rendered);

          if (dry) {
            if (sentSample.length < 10)
              sentSample.push({
                leadId: String((lead as any)._id),
                dripId: String(dripId),
                step: step.day,
                duePT: duePT.toISO(),
                preview: finalBody.slice(0, 120),
              });
            nextIndex++;
            advancedAtLeastOne = true;
            continue;
          }

          try {
            const result = await sendSms({
              to,
              body: finalBody,
              userEmail: user.email,
              leadId: String((lead as any)._id),
            });

            if (result.sid) {
              if (result.scheduledAt) {
                scheduled++;
                bumpDrip(String(dripId), "scheduled");
              } else {
                accepted++;
                bumpDrip(String(dripId), "sentAccepted");
              }
              if (sentSample.length < 10)
                sentSample.push({
                  leadId: String((lead as any)._id),
                  dripId: String(dripId),
                  step: step.day,
                  sid: result.sid,
                  scheduledAt: result.scheduledAt || null,
                });
            } else {
              suppressed++;
              bumpDrip(String(dripId), "suppressed");
              if (skippedSample.length < 10)
                skippedSample.push({
                  leadId: String((lead as any)._id),
                  dripId: String(dripId),
                  step: step.day,
                  reason: "suppressed",
                  messageId: result.messageId || null,
                });
            }

            // Advance progress index even if suppressed (so we don't loop forever)
            await Lead.updateOne(
              { _id: (lead as any)._id, "dripProgress.dripId": String(dripId) },
              { $set: { "dripProgress.$.lastSentIndex": nextIndex } },
            );

            nextIndex++;
            advancedAtLeastOne = true;
          } catch (e: any) {
            failed++;
            bumpDrip(String(dripId), "failed");
            if (skippedSample.length < 10)
              skippedSample.push({
                leadId: String((lead as any)._id),
                dripId: String(dripId),
                step: step.day,
                reason: "sendError",
                error: e?.message || String(e),
              });
            // On failure, do not advance further steps for this drip on this run
            break;
          }
        }

        if (!advancedAtLeastOne && nextIndex < steps.length) {
          // Nothing sent and we broke due to 'notDue'
        }
      }
    });

    // Summarize per-campaign
    const perCampaign: Record<string, DripCounters & { id: string }> = {};
    for (const [id, c] of perDripCounters.entries()) {
      perCampaign[id] = { id, ...c };
      console.log(
        `🧾 drip=${id} considered=${c.considered} ✅=${c.sentAccepted} 🕘=${c.scheduled} ⚠️=${c.suppressed} ❌=${c.failed}`,
      );
    }

    const response = {
      message: "run-drips complete",
      nowPT: DateTime.now().setZone(PT_ZONE).toISO(),
      forced: force,
      dryRun: dry,
      leadsChecked: checked,
      candidates,
      accepted,
      scheduled,
      suppressed,
      failed,
      initializedProgress,
      wouldInitProgress,
      skippedByReason,
      perCampaign,
      examples: {
        sentSample,
        skippedSample,
      },
    };

    console.log(
      `🏁 run-drips done checked=${checked} candidates=${candidates} ✅accepted=${accepted} 🕘scheduled=${scheduled} ⚠️suppressed=${suppressed} ❌failed=${failed} 🧩init=${initializedProgress} (would=${wouldInitProgress})`,
    );

    return res.status(200).json(response);
  } catch (error) {
    console.error("❌ run-drips error:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
