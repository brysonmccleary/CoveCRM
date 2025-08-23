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

/** Guard: only operate when now is 9AM PT (unless DRIPS_DEBUG_ALWAYS_RUN=1) */
function shouldRunNowPT(): boolean {
  if (process.env.DRIPS_DEBUG_ALWAYS_RUN === "1") return true;
  const nowPT = DateTime.now().setZone(PT_ZONE);
  return nowPT.hour === SEND_HOUR_PT; // run exactly on the hour; schedule cron accordingly
}

type DripCounters = {
  considered: number;
  sentAccepted: number;
  scheduled: number;
  suppressed: number;
  failed: number;
};

// --- Handler ---
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  if (!shouldRunNowPT()) {
    return res.status(200).json({
      message:
        "Not run window (expects 9:00 AM PT). Set DRIPS_DEBUG_ALWAYS_RUN=1 to override.",
    });
  }

  try {
    await dbConnect();

    const nowPT = DateTime.now().setZone(PT_ZONE);
    console.log(`🕘 run-drips start @ ${nowPT.toISO()} PT`);

    // Fetch leads with assigned drips & progress; skip unsubscribed/opt-out proactively
    const leads = await Lead.find({
      $and: [
        { unsubscribed: { $ne: true } },
        { optOut: { $ne: true } }, // extra guard; sendSms will also suppress
        { assignedDrips: { $exists: true, $ne: [] } },
        { dripProgress: { $exists: true, $ne: [] } },
      ],
    })
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

    console.log(`📋 Leads eligible: ${leads.length}`);

    let checked = 0;
    let sent = 0;
    let failed = 0;

    const perDripCounters = new Map<string, DripCounters>();
    function bump(dripId: string, key: keyof DripCounters) {
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

    await runBatched(leads, PER_LEAD_CONCURRENCY, async (lead) => {
      checked++;

      const to = normalizeToE164Maybe((lead as any).Phone);
      if (!to) {
        console.warn(`⚠️ lead=${(lead as any)._id} missing/invalid Phone`);
        return;
      }

      // Lookup agent/user for rendering context + A2P gating
      const user = await User.findOne({ email: (lead as any).userEmail })
        .select({ _id: 1, email: 1, name: 1 })
        .lean();
      if (!user?._id) {
        console.warn(`⚠️ user not found for lead=${(lead as any)._id}`);
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

      // Iterate each assigned drip for this lead
      const assigned: string[] = Array.isArray((lead as any).assignedDrips)
        ? (lead as any).assignedDrips
        : [];
      const progressArr: any[] = Array.isArray((lead as any).dripProgress)
        ? (lead as any).dripProgress
        : [];

      for (const dripId of assigned) {
        // Find or skip if we have no progress record (we start progress on assignment/first send)
        const prog = progressArr.find(
          (p) => String(p.dripId) === String(dripId),
        );
        if (!prog || !prog.startedAt) continue;

        // Load drip and sort steps by Day number
        const dripDoc: any = await resolveDrip(dripId);
        if (!dripDoc || dripDoc.type !== "sms") continue;
        const steps = sortDaySteps(dripDoc);
        if (!steps.length) continue;

        // Determine next step index to consider
        let nextIndex =
          (typeof prog.lastSentIndex === "number" ? prog.lastSentIndex : -1) +
          1;

        // Sequentially catch-up any missed steps (still at 9am PT gate)
        while (nextIndex < steps.length) {
          const step = steps[nextIndex];
          const dayNum = parseStepDayNumber(step.day);
          if (isNaN(dayNum)) break;

          const duePT = computeStepWhenPT(new Date(prog.startedAt), dayNum);
          if (DateTime.now().setZone(PT_ZONE) < duePT) break; // not yet time for this next step

          bump(String(dripId), "considered");
          console.log(
            `📆 lead=${(lead as any)._id} drip=${String(
              dripId,
            )} stepIndex=${nextIndex} day=${step.day} duePT=${duePT.toISO()}`,
          );

          // Safety: don't send raw opt-out keywords as a message
          const raw = String(step.text || "");
          const lower = raw.trim().toLowerCase();
          const optOutKeywords = ["stop", "unsubscribe", "end", "quit", "cancel"];
          if (optOutKeywords.includes(lower)) {
            console.log(
              `⚠️ skipping step containing opt-out keyword (lead=${(lead as any)._id}, drip=${String(
                dripId,
              )}, day=${step.day})`,
            );
            nextIndex++;
            continue;
          }

          try {
            // Render with names
            const rendered = renderTemplate(raw, {
              contact: {
                first_name: firstName,
                last_name: lastName,
                full_name: fullName,
              },
              agent: agentCtx,
            });
            const finalBody = ensureOptOut(rendered);

            console.log(
              `⏳ queue send lead=${(lead as any)._id} drip=${String(
                dripId,
              )} step=${step.day}`,
            );

            const result = await sendSms({
              to,
              body: finalBody,
              userEmail: user.email,
              leadId: String((lead as any)._id),
            });

            // Note: sendSms creates Message row and handles quiet-hours scheduling/opt-out
            if (result.sid) {
              if (result.scheduledAt) {
                console.log(
                  `🕘 scheduled lead=${(lead as any)._id} drip=${String(
                    dripId,
                  )} step=${step.day} sid=${result.sid} at=${result.scheduledAt}`,
                );
                bump(String(dripId), "scheduled");
              } else {
                console.log(
                  `✅ accepted lead=${(lead as any)._id} drip=${String(
                    dripId,
                  )} step=${step.day} sid=${result.sid}`,
                );
                bump(String(dripId), "sentAccepted");
              }
            } else {
              console.log(
                `⚠️ suppressed lead=${(lead as any)._id} drip=${String(
                  dripId,
                )} step=${step.day} messageId=${result.messageId}`,
              );
              bump(String(dripId), "suppressed");
            }

            // Mark progress: lastSentIndex -> nextIndex (even if suppressed)
            await Lead.updateOne(
              { _id: (lead as any)._id, "dripProgress.dripId": String(dripId) },
              { $set: { "dripProgress.$.lastSentIndex": nextIndex } },
            );

            sent++;
          } catch (e: any) {
            console.error(
              `❌ drip send failed lead=${(lead as any)._id} drip=${String(
                dripId,
              )} step=${step.day}:`,
              e?.message || e,
            );
            bump(String(dripId), "failed");
            failed++;
            // On failure, do not advance index; exit loop for this drip to retry next run
            break;
          }

          // Move to potential next due step (catch-up if the app missed previous days)
          nextIndex++;
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

    console.log(
      `🏁 run-drips done leadsChecked=${checked} sentAccepted=${sent} failed=${failed}`,
    );

    return res.status(200).json({
      message: "run-drips executed at 9:00 AM PT",
      leadsChecked: checked,
      sentAccepted: sent,
      failed,
      perCampaign,
    });
  } catch (error) {
    console.error("❌ run-drips error:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
