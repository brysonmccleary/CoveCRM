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
};

// Next 9:00am PT
function nextWindowPT(): Date {
  const nowPT = DateTime.now().setZone(PT_ZONE);
  const base = nowPT.hour < SEND_HOUR_PT ? nowPT : nowPT.plus({ days: 1 });
  return base.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.DRIPS_HARD_STOP === "1") return res.status(204).end(); // safe pause
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  try {
    await dbConnect();

    // Prevent overlap
    const ok = await acquireLock("cron", "drips-folder-watch", 50);
    if (!ok) return res.status(200).json({ message: "Already running, skipping" });

    const watchers = await DripFolderEnrollment.find({ active: true })
      .select({ _id: 1, userEmail: 1, folderId: 1, campaignId: 1, startMode: 1, lastScanAt: 1 })
      .lean<Watcher[]>();

    let scanned = 0, newlyEnrolled = 0, deduped = 0;

    for (const w of watchers) {
      scanned++;

      // Isolate each watcher (best-effort)
      const wLock = await acquireLock("watch", `folder:${String(w._id)}`, 45);
      if (!wLock) continue;

      // Ensure campaign is SMS + active (TS-safe narrowing)
      const campaign = (await DripCampaign.findById(w.campaignId)
        .select({ _id: 1, isActive: 1, type: 1 })
        .lean()) as CampaignLite | null;

      if (!campaign || campaign.type !== "sms" || campaign.isActive !== true) {
        await DripFolderEnrollment.updateOne({ _id: w._id }, { $set: { active: false } });
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

      const nextSendAt = w.startMode === "nextWindow" ? nextWindowPT() : new Date();

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
              nextSendAt,
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
    });
  } catch (err) {
    console.error("❌ scan-folder-enrollments error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
