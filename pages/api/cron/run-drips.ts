// /pages/api/cron/run-drips.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";
import DripCampaign from "@/models/DripCampaign";
import { sendSMS } from "@/lib/twilio/sendSMS";
import {
  renderTemplate,
  ensureOptOut,
  splitName,
} from "@/utils/renderTemplate";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import { DateTime } from "luxon";

// --- Config ---
const PT_ZONE = "America/Los_Angeles"; // 9:00 AM Pacific
const SEND_HOUR_PT = 9;

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
  const startPT = DateTime.fromJSDate(startedAt, { zone: PT_ZONE }).startOf(
    "day",
  );
  // Day 1 => +0 days; Day N => +(N-1) days
  const offsetDays = Math.max(0, dayNumber - 1);
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

// --- Handler ---
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  if (!shouldRunNowPT()) {
    return res
      .status(200)
      .json({
        message:
          "Not run window (expects 9:00 AM PT). Set DRIPS_DEBUG_ALWAYS_RUN=1 to override.",
      });
  }

  try {
    await dbConnect();

    const nowPT = DateTime.now().setZone(PT_ZONE);

    // Fetch leads that have assigned drips and a progress record; skip unsubscribed
    const leads = await Lead.find({
      unsubscribed: { $ne: true },
      assignedDrips: { $exists: true, $ne: [] },
      dripProgress: { $exists: true, $ne: [] },
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

    let checked = 0;
    let sent = 0;
    let failed = 0;
    const perLeadBatch = 10;

    await runBatched(leads, perLeadBatch, async (lead) => {
      checked++;

      const to = normalizeToE164Maybe((lead as any).Phone);
      if (!to) return;

      // Lookup agent/user for rendering context + A2P gating
      const user = await User.findOne({ email: (lead as any).userEmail })
        .select({ _id: 1, email: 1, name: 1 })
        .lean();
      if (!user?._id) return;

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
        const drip = await resolveDrip(dripId);
        if (!drip || drip.type !== "sms") continue;
        const steps = sortDaySteps(drip);
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
          if (nowPT < duePT) break; // not yet time for this next step

          // Safety: don't send raw opt-out keywords as a message
          const raw = String(step.text || "");
          const lower = raw.trim().toLowerCase();
          const optOutKeywords = [
            "stop",
            "unsubscribe",
            "end",
            "quit",
            "cancel",
          ];
          if (optOutKeywords.includes(lower)) {
            // Skip and advance to avoid getting stuck
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

            await sendSMS(to, finalBody, String(user._id));

            // Mark progress: lastSentIndex -> nextIndex
            await Lead.updateOne(
              { _id: (lead as any)._id, "dripProgress.dripId": String(dripId) },
              { $set: { "dripProgress.$.lastSentIndex": nextIndex } },
            );

            sent++;
          } catch (e) {
            console.error("Scheduled drip send failed:", e);
            failed++;
            // On failure, do not advance index; exit loop for this drip to retry next run
            break;
          }

          // Move to potential next due step (catch-up if the app missed previous days)
          nextIndex++;
        }
      }
    });

    return res.status(200).json({
      message: "run-drips executed at 9:00 AM PT",
      leadsChecked: checked,
      sent,
      failed,
    });
  } catch (error) {
    console.error("❌ run-drips error:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
