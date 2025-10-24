// pages/api/drips/enroll-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import DripCampaign from "@/models/DripCampaign";
import DripEnrollment from "@/models/DripEnrollment";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import { DateTime } from "luxon";

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;

type Body = {
  folderId?: string;
  campaignId?: string;
  startMode?: "immediate" | "nextWindow"; // default immediate
  dry?: boolean;
  limit?: number; // optional cap when seeding (safety)
};

// Narrowed lean type so TS doesn't think it could be an array/union
type CampaignLean = null | {
  _id: any;
  name?: string;
  isActive?: boolean;
  type?: string;
  steps?: any;
};

function nextWindowPT(): Date {
  const nowPT = DateTime.now().setZone(PT_ZONE);
  const base = nowPT.hour < SEND_HOUR_PT ? nowPT : nowPT.plus({ days: 1 });
  return base.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const { folderId, campaignId, startMode = "immediate", dry, limit }: Body = req.body || {};
    if (!folderId || !campaignId) return res.status(400).json({ error: "folderId and campaignId are required" });

    await dbConnect();

    // Validate campaign (narrow the type on the result)
    const campaign = (await DripCampaign.findOne({ _id: campaignId })
      .select("_id name isActive type steps")
      .lean()) as CampaignLean;

    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.type !== "sms") return res.status(400).json({ error: "Campaign must be SMS type" });
    if (campaign.isActive !== true) return res.status(400).json({ error: "Campaign is not active" });

    // Create (or keep) the Folder watcher
    const watcher = await DripFolderEnrollment.findOneAndUpdate(
      { userEmail: session.user.email, folderId, campaignId, active: true },
      {
        $setOnInsert: {
          userEmail: session.user.email,
          folderId,
          campaignId,
          active: true,
          startMode,
          lastScanAt: new Date(0), // force an initial full scan below
        },
        $set: { startMode },
      },
      { upsert: true, new: true }
    ).lean();

    // Seed enrollments for existing leads in the folder (idempotent)
    // - Only leads that don't already have an active/paused enrollment for this campaign
    const q: any = {
      userEmail: session.user.email,
      folderId,
    };

    const leads = await Lead.find(q)
      .select({ _id: 1 })
      .limit(Math.max(0, Number(limit) || 10_000)) // safety cap for initial seed
      .lean();

    let created = 0, deduped = 0;

    const nextSendAt = startMode === "nextWindow" ? nextWindowPT() : new Date();

    for (const lead of leads) {
      if (dry) { created++; continue; }

      const before = await DripEnrollment.findOne({
        userEmail: session.user.email,
        leadId: lead._id,
        campaignId,
        status: { $in: ["active", "paused"] },
      })
        .select({ _id: 1 })
        .lean();

      if (before?._id) { deduped++; continue; }

      await DripEnrollment.findOneAndUpdate(
        {
          userEmail: session.user.email,
          leadId: lead._id,
          campaignId,
          status: { $in: ["active", "paused"] },
        },
        {
          $setOnInsert: {
            userEmail: session.user.email,
            leadId: lead._id,
            campaignId,
            status: "active",
            cursorStep: 0,            // initial text
            nextSendAt,               // send once
            source: "folder-bulk",
          },
        },
        { upsert: true, new: true }
      );

      created++;
    }

    // Prime the watcher scan time so the cron won't re-seed immediately
    if (!dry) {
      await DripFolderEnrollment.updateOne(
        { _id: watcher._id },
        { $set: { lastScanAt: new Date() } }
      );
    }

    return res.status(200).json({
      success: true,
      watcherId: watcher._id,
      campaign: { id: String(campaign._id), name: campaign.name },
      seeded: { created, deduped },
      startMode,
      nextSendAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}
