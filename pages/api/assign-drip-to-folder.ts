// pages/api/assign-drip-to-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import DripCampaign from "@/models/DripCampaign";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import DripEnrollment from "@/models/DripEnrollment";
import User from "@/models/User";
import { ObjectId } from "mongodb";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import { DateTime } from "luxon";

// ---------- helpers ----------
function isValidObjectId(id: string) {
  return /^[a-f0-9]{24}$/i.test(id);
}

async function resolveDrip(dripId: string) {
  if (isValidObjectId(dripId)) return await DripCampaign.findById(dripId).lean();
  const def = prebuiltDrips.find((d) => d.id === dripId);
  if (!def) return null;
  return await DripCampaign.findOne({ isGlobal: true, name: def.name }).lean();
}

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;
const QUIET_START = Number(process.env.DRIPS_QUIET_START_HOUR_PT ?? 21); // 21 = 9pm
const QUIET_END   = Number(process.env.DRIPS_QUIET_END_HOUR_PT   ?? 8);  //  8 = 8am

function isQuietHoursPT(now = DateTime.now().setZone(PT_ZONE)) {
  const h = now.hour;
  // Handles windows that cross midnight (default 21→08)
  return QUIET_START > QUIET_END ? (h >= QUIET_START || h < QUIET_END)
                                 : (h >= QUIET_START && h < QUIET_END);
}

function computeNextWindowPT(now = DateTime.now().setZone(PT_ZONE)): Date {
  const today9 = now.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
  const when = now < today9 ? today9 : today9.plus({ days: 1 });
  return when.toJSDate();
}

// ---------- handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  // EXPLICIT CAST to avoid TS inferring {} and erroring on `.user`
  const session: any = await getServerSession(req, res, authOptions as any);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { dripId, folderId } = (req.body || {}) as { dripId?: string; folderId?: string };
  if (!dripId || !folderId) return res.status(400).json({ message: "Missing dripId or folderId" });

  try {
    await dbConnect();
    const userEmail = String(session.user.email).toLowerCase();

    // 1) Validate user & folder
    const user = await User.findOne({ email: userEmail }).select({ _id: 1, email: 1, name: 1 }).lean();
    if (!user?._id) return res.status(404).json({ message: "User not found" });

    const folder = await Folder.findOne({ _id: new ObjectId(folderId), userEmail })
      .select({ _id: 1, assignedDrips: 1 })
      .lean();
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // 2) Resolve drip campaign (must be SMS with steps)
    const dripDoc: any = await resolveDrip(dripId);
    if (!dripDoc || dripDoc.type !== "sms" || !Array.isArray(dripDoc.steps) || dripDoc.steps.length === 0) {
      // Still attach the watcher so NEW leads get enrolled later
      await DripFolderEnrollment.updateOne(
        { userEmail, folderId: new ObjectId(folderId), campaignId: new ObjectId(dripId), active: true },
        { $set: { active: true, startMode: "immediate" } },
        { upsert: true }
      );
      return res.status(200).json({ message: "Drip assigned (non-SMS or no steps). No backfill performed." });
    }

    const campaignId = String(dripDoc._id || dripId);

    // 3) Attach/ensure watcher (idempotent; immediate start by default)
    await DripFolderEnrollment.updateOne(
      { userEmail, folderId: new ObjectId(folderId), campaignId: new ObjectId(campaignId), active: true },
      { $set: { active: true, startMode: "immediate" } },
      { upsert: true }
    );

    // 4) Add the drip to the folder metadata (idempotent)
    await Folder.updateOne(
      { _id: new ObjectId(folderId), userEmail },
      { $addToSet: { assignedDrips: campaignId } }
    );

    // 5) Backfill existing leads into DripEnrollment, Day 1 exactly once
    const nowPT = DateTime.now().setZone(PT_ZONE);
    const effectiveWhen = isQuietHoursPT(nowPT) ? computeNextWindowPT(nowPT) : nowPT.toJSDate();

    const leads = await Lead.find({ userEmail, folderId: new ObjectId(folderId) })
      .select({ _id: 1, unsubscribed: 1, Phone: 1 })
      .lean();

    let considered = 0, created = 0, activated = 0, skippedAlreadySent = 0;

    const BATCH = 200;
    for (let i = 0; i < leads.length; i += BATCH) {
      const slice = leads.slice(i, i + BATCH);
      await Promise.all(slice.map(async (lead: any) => {
        considered++;
        if (lead.unsubscribed) return;

        const existing = await DripEnrollment.findOne({
          userEmail, leadId: lead._id, campaignId: new ObjectId(campaignId),
          status: { $in: ["active", "paused"] }
        }).select({ _id: 1, sentAtByIndex: 1, status: 1, nextSendAt: 1 }).lean();

        if (!existing) {
          await DripEnrollment.findOneAndUpdate(
            {
              userEmail,
              leadId: lead._id,
              campaignId: new ObjectId(campaignId),
              status: { $in: ["active", "paused"] },
            },
            {
              $setOnInsert: {
                userEmail,
                leadId: lead._id,
                campaignId: new ObjectId(campaignId),
                status: "active",
                active: true, isActive: true, enabled: true,
                paused: false, isPaused: false, stopAll: false,
                cursorStep: 0,
                nextSendAt: effectiveWhen,   // now unless quiet hours → next 9am PT
                startedAt: new Date(),
                source: "folder-bulk",
              },
            },
            { upsert: true, new: false }
          ).lean();
          created++;
          return;
        }

        const day0Sent =
          (existing as any)?.sentAtByIndex &&
          (existing as any).sentAtByIndex.get?.("0");
        if (day0Sent) {
          skippedAlreadySent++;
          return;
        }

        await DripEnrollment.updateOne(
          { _id: existing._id },
          {
            $set: {
              status: "active",
              active: true, isActive: true, enabled: true,
              paused: false, isPaused: false, stopAll: false,
              nextSendAt: effectiveWhen,
            },
            $setOnInsert: { cursorStep: 0, startedAt: new Date(), source: "folder-bulk" },
          }
        );
        activated++;
      }));
    }

    return res.status(200).json({
      message: "Drip assigned; watcher active; existing leads backfilled idempotently via DripEnrollment.",
      considered, created, activated, skippedAlreadySent,
      nextWindowUsedForQuietHours: isQuietHoursPT(nowPT),
    });
  } catch (error) {
    console.error("Error assigning drip:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
