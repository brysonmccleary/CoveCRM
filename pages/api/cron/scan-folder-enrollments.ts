// pages/api/cron/scan-folder-enrollments.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import { DateTime } from "luxon";
import Lead from "@/models/Lead";
import DripEnrollment from "@/models/DripEnrollment";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import DripCampaign from "@/models/DripCampaign";
import { acquireLock } from "@/lib/locks";

export const config = { maxDuration: 60 };

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;

type Watcher = {
  _id: any;
  userEmail: string;
  folderId: any;
  campaignId: any;
  startMode?: "immediate" | "nextWindow";
  lastScanAt?: Date;
};

type CampaignLite = {
  _id: any;
  isActive?: boolean;
  type?: string;
  steps?: Array<{ day?: string }>;
};

/** Parse "Day 1", "1", "day-3", etc → 1,3 ... returns NaN if missing. */
function parseStepDayNumber(dayField?: string): number {
  if (!dayField) return NaN;
  const m = String(dayField).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

/** Next 9:00 AM PT from *now*. */
function nextWindowPT(): DateTime {
  const now = DateTime.now().setZone(PT_ZONE);
  const today9 = now.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
  return now < today9 ? today9 : today9.plus({ days: 1 });
}

/**
 * Compute the initial nextSendAt for a new enrollment.
 * - Looks at the campaign's *first* step day number.
 * - "immediate": if Day 1 and it's already after 9 AM PT today → send now;
 *                otherwise window to the proper 9 AM PT slot.
 * - "nextWindow": always schedule at the next 9 AM PT, then add (day-1) days.
 */
function computeInitialNextSendAtPT(
  startMode: "immediate" | "nextWindow",
  campaign: CampaignLite
): Date {
  const steps = Array.isArray(campaign.steps) ? campaign.steps : [];
  const first = steps[0];
  const dayNum = parseStepDayNumber(first?.day) || 1;

  const nowPT = DateTime.now().setZone(PT_ZONE);
  const today9 = nowPT.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });

  if (startMode === "immediate") {
    if (dayNum <= 1) {
      // Day 1:
      // - before 9am PT → today @ 9am PT
      // - at/after 9am PT → now (eligible immediately)
      return (nowPT >= today9 ? nowPT : today9).toJSDate();
    }
    // Day > 1 → anchor to the next 9am window, then offset (day-1)
    const base = nextWindowPT();
    return base.plus({ days: dayNum - 1 }).toJSDate();
  }

  // startMode === "nextWindow"
  const base = nextWindowPT();
  return base.plus({ days: Math.max(0, dayNum - 1) }).toJSDate();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.DRIPS_HARD_STOP === "1") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  try {
    await dbConnect();

    // Prevent overlap
    const ok = await acquireLock("cron", "drips-folder-watch", 50);
    if (!ok) return res.status(200).json({ message: "Already running, skipping" });

    const watchers = await DripFolderEnrollment.find({ active: true })
      .select({ _id: 1, userEmail: 1, folderId: 1, campaignId: 1, startMode: 1, lastScanAt: 1 })
      .lean<Watcher[]>();

    let scanned = 0, newlyEnrolled = 0, deduped = 0, deactivated = 0;

    for (const w of watchers) {
      scanned++;

      // Isolate each watcher (best-effort)
      const wLock = await acquireLock("watch", `folder:${String(w._id)}`, 45);
      if (!wLock) continue;

      // Ensure campaign is SMS + active and fetch first step day
      const campaign = (await DripCampaign.findById(w.campaignId)
        .select({ _id: 1, isActive: 1, type: 1, steps: 1 })
        .lean()) as CampaignLite | null;

      if (!campaign || campaign.type !== "sms" || campaign.isActive !== true) {
        await DripFolderEnrollment.updateOne({ _id: w._id }, { $set: { active: false } });
        deactivated++;
        continue;
      }

      // Find leads in this folder that *do not* already have an active/paused enrollment for this campaign
      const leads = await Lead.aggregate([
        { $match: { userEmail: w.userEmail, folderId: w.folderId } },
        {
          $lookup: {
            from: "dripenrollments",
            let: { leadId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$leadId", "$$leadId"] },
                      { $eq: ["$campaignId", w.campaignId] },
                      { $in: ["$status", ["active", "paused"]] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: "enr",
          },
        },
        { $match: { enr: { $size: 0 } } },
        { $project: { _id: 1 } },
        { $limit: 2000 }, // safety per tick
      ]);

      // Compute initial schedule per watcher/campaign
      const initialNext = computeInitialNextSendAtPT(w.startMode || "immediate", campaign);

      for (const lead of leads) {
        const before = await DripEnrollment.findOne({
          userEmail: w.userEmail,
          leadId: lead._id,
          campaignId: w.campaignId,
          status: { $in: ["active", "paused"] },
        })
          .select({ _id: 1 })
          .lean();

        if (before?._id) { deduped++; continue; }

        await DripEnrollment.findOneAndUpdate(
          {
            userEmail: w.userEmail,
            leadId: lead._id,
            campaignId: w.campaignId,
            status: { $in: ["active", "paused"] },
          },
          {
            $setOnInsert: {
              userEmail: w.userEmail,
              leadId: lead._id,
              campaignId: w.campaignId,
              status: "active",
              cursorStep: 0,
              nextSendAt: initialNext,
              source: "folder-bulk",
            },
          },
          { upsert: true, new: true }
        );

        newlyEnrolled++;
      }

      await DripFolderEnrollment.updateOne({ _id: w._id }, { $set: { lastScanAt: new Date() } });
    }

    return res.status(200).json({
      message: "scan-folder-enrollments complete",
      scannedWatchers: scanned,
      newlyEnrolled,
      deduped,
      deactivated,
    });
  } catch (err) {
    console.error("❌ scan-folder-enrollments error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
