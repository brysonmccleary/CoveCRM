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
  startMode?: "immediate" | "nextWindow";
  dry?: boolean;
  limit?: number;
};

type CampaignLite = {
  _id: any;
  name?: string;
  isActive?: boolean;
  type?: string;
  steps?: any[];
};

function nextWindowPT(): Date {
  const nowPT = DateTime.now().setZone(PT_ZONE);
  const base = nowPT.hour < SEND_HOUR_PT ? nowPT : nowPT.plus({ days: 1 });
  return base
    .set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 })
    .toJSDate();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const session = (await getServerSession(
      req,
      res,
      authOptions as any
    )) as any;
    if (!session?.user?.email)
      return res.status(401).json({ error: "Unauthorized" });

    const {
      folderId,
      campaignId,
      startMode = "immediate",
      dry,
      limit,
    }: Body = (req.body || {}) as any;

    if (!folderId || !campaignId)
      return res
        .status(400)
        .json({ error: "folderId and campaignId are required" });

    await dbConnect();

    // Validate campaign (TS-safe)
    const campaign = await DripCampaign.findById(campaignId)
      .select("_id name isActive type steps")
      .lean<CampaignLite | null>();

    if (!campaign)
      return res.status(404).json({ error: "Campaign not found" });
    if (campaign.type !== "sms")
      return res.status(400).json({ error: "Campaign must be SMS type" });
    if (campaign.isActive !== true)
      return res.status(400).json({ error: "Campaign is not active" });

    // Ensure/Upsert a watcher
    const watcher = await DripFolderEnrollment.findOneAndUpdate(
      { userEmail: session.user.email, folderId, campaignId, active: true },
      {
        $setOnInsert: {
          userEmail: session.user.email,
          folderId,
          campaignId,
          active: true,
          startMode,
          lastScanAt: new Date(0),
        },
        $set: { startMode },
      },
      { upsert: true, new: true }
    ).lean();

    // Seed enrollments for existing leads in this folder (idempotent)
    const leads = await Lead.find({
      userEmail: session.user.email,
      folderId,
    })
      .select({ _id: 1 })
      .limit(Math.max(0, Number(limit) || 10000))
      .lean();

    let created = 0,
      deduped = 0;

    const nextSendAt =
      startMode === "nextWindow" ? nextWindowPT() : new Date();

    for (const lead of leads) {
      if (dry) {
        created++;
        continue;
      }

      const before = await DripEnrollment.findOne({
        userEmail: session.user.email,
        leadId: lead._id,
        campaignId,
        status: { $in: ["active", "paused"] },
      })
        .select({ _id: 1 })
        .lean();

      if (before?._id) {
        deduped++;
        continue;
      }

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
            cursorStep: 0,
            nextSendAt,
            source: "folder-bulk",
          },
        },
        { upsert: true, new: true }
      );

      created++;
    }

    // Mark scan time so the watcher cron won't re-seed immediately
    if (!dry && watcher?._id) {
      await DripFolderEnrollment.updateOne(
        { _id: watcher._id },
        { $set: { lastScanAt: new Date() } }
      );
    }

    return res.status(200).json({
      success: true,
      watcherId: watcher?._id,
      campaign: { id: String(campaign._id), name: campaign.name },
      seeded: { created, deduped },
      startMode,
      nextSendAt,
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: "Server error", detail: err?.message });
  }
}
