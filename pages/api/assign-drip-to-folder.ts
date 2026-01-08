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
  // If dripId is an actual DripCampaign _id
  if (isValidObjectId(dripId)) return await DripCampaign.findById(dripId).lean();

  // Otherwise it’s a prebuilt ID -> map to global campaign by name
  const def = prebuiltDrips.find((d) => d.id === dripId);
  if (!def) return null;

  return await DripCampaign.findOne({ isGlobal: true, name: def.name }).lean();
}

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;

// Quiet hours (PT)
const QUIET_START = Number(process.env.DRIPS_QUIET_START_HOUR_PT ?? 21); // 21 = 9pm
const QUIET_END = Number(process.env.DRIPS_QUIET_END_HOUR_PT ?? 8); // 8 = 8am

function isQuietHoursPT(now = DateTime.now().setZone(PT_ZONE)) {
  const h = now.hour;
  // Handles windows that cross midnight (default 21→08)
  return QUIET_START > QUIET_END
    ? h >= QUIET_START || h < QUIET_END
    : h >= QUIET_START && h < QUIET_END;
}

// Next 9:00am PT
function nextWindowPT(now = DateTime.now().setZone(PT_ZONE)): Date {
  const today9 = now.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
  const when = now < today9 ? today9 : today9.plus({ days: 1 });
  return when.toJSDate();
}

// ---------- handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session: any = await getServerSession(req, res, authOptions as any);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { dripId, folderId } = (req.body || {}) as { dripId?: string; folderId?: string };
  if (!dripId || !folderId) return res.status(400).json({ message: "Missing dripId or folderId" });

  try {
    await dbConnect();
    const userEmail = String(session.user.email).toLowerCase();

    // 1) Validate user & folder
    const user = await User.findOne({ email: userEmail })
      .select({ _id: 1, email: 1, name: 1 })
      .lean();
    if (!user?._id) return res.status(404).json({ message: "User not found" });

    const folder = await Folder.findOne({ _id: new ObjectId(folderId), userEmail })
      .select({ _id: 1, assignedDrips: 1, name: 1 })
      .lean();
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // 2) Resolve drip campaign
    const dripDoc: any = await resolveDrip(dripId);
    if (!dripDoc?._id) return res.status(404).json({ message: "Drip campaign not found" });

    const campaignId = String(dripDoc._id);

    // 3) Always attach/ensure watcher (idempotent)
    await DripFolderEnrollment.updateOne(
      { userEmail, folderId: new ObjectId(folderId), campaignId: new ObjectId(campaignId) },
      { $set: { active: true, startMode: "immediate" }, $setOnInsert: { lastScanAt: new Date(0) } },
      { upsert: true }
    );

    // 4) Add the drip to the folder metadata (idempotent)
    await Folder.updateOne(
      { _id: new ObjectId(folderId), userEmail },
      { $addToSet: { assignedDrips: campaignId } }
    );

    // If not a sendable SMS campaign, stop here (watcher still active for future logic)
    const isSendableSms =
      dripDoc.type === "sms" &&
      dripDoc.isActive === true &&
      Array.isArray(dripDoc.steps) &&
      dripDoc.steps.length > 0;

    if (!isSendableSms) {
      return res.status(200).json({
        message: "Drip assigned, watcher enabled. Campaign is not an active SMS drip with steps; no backfill performed.",
        campaignId,
      });
    }

    // 5) Backfill: seed DripEnrollment for existing leads (do NOT send here; runner sends)
    const nowPT = DateTime.now().setZone(PT_ZONE);
    const seedNextSendAt = isQuietHoursPT(nowPT) ? nextWindowPT(nowPT) : new Date();

    // IMPORTANT: don't narrow projections; imports vary. Use full docs only if needed.
    const leads = await Lead.find({ userEmail, folderId: new ObjectId(folderId) })
      .select({ _id: 1, unsubscribed: 1 })
      .lean();

    let considered = 0;
    let deduped = 0;
    let created = 0;
    let skippedUnsub = 0;

    const BATCH = 250;

    for (let i = 0; i < leads.length; i += BATCH) {
      const slice = leads.slice(i, i + BATCH);

      await Promise.allSettled(
        slice.map(async (lead: any) => {
          considered++;
          if (lead?.unsubscribed) {
            skippedUnsub++;
            return;
          }

          const exists = await DripEnrollment.findOne({
            userEmail,
            leadId: lead._id,
            campaignId: new ObjectId(campaignId),
            status: { $in: ["active", "paused"] },
          })
            .select({ _id: 1 })
            .lean();

          if (exists?._id) {
            deduped++;
            return;
          }

          await DripEnrollment.create({
            userEmail,
            leadId: lead._id,
            campaignId: new ObjectId(campaignId),
            status: "active",
            cursorStep: 0,
            nextSendAt: seedNextSendAt, // now unless quiet hours -> next 9am PT
            source: "folder-bulk",
          });

          created++;
        })
      );
    }

    // Prime watcher scan time so folder-watch doesn't immediately re-seed everything
    await DripFolderEnrollment.updateOne(
      { userEmail, folderId: new ObjectId(folderId), campaignId: new ObjectId(campaignId) },
      { $set: { lastScanAt: new Date() } }
    );

    return res.status(200).json({
      message: "Drip assigned; watcher active; existing leads seeded into DripEnrollment (runner will send).",
      campaignId,
      quietHours: isQuietHoursPT(nowPT),
      seedNextSendAt,
      considered,
      deduped,
      created,
      skippedUnsub,
    });
  } catch (error) {
    console.error("Error assigning drip:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
