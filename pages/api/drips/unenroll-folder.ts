// pages/api/drips/unenroll-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import DripEnrollment from "@/models/DripEnrollment";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import mongoose from "mongoose";

type Body = {
  folderId?: string;
  campaignId?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const { folderId, campaignId }: Body = req.body || {};
    if (!folderId || !campaignId) return res.status(400).json({ error: "folderId and campaignId are required" });

    await dbConnect();

    const email = String(session.user.email).toLowerCase();
    const folderObjectId =
      mongoose.Types.ObjectId.isValid(folderId) ? new mongoose.Types.ObjectId(folderId) : folderId;
    const campaignObjectId =
      mongoose.Types.ObjectId.isValid(campaignId) ? new mongoose.Types.ObjectId(campaignId) : campaignId;

    const upd = await DripFolderEnrollment.updateOne(
      { userEmail: email, folderId: folderObjectId, campaignId: campaignObjectId, active: true },
      { $set: { active: false } }
    );

    await Folder.updateOne(
      { _id: folderObjectId, userEmail: email },
      { $pull: { assignedDrips: campaignId } }
    );

    const leads = await Lead.find({
      folderId: folderObjectId,
      $or: [{ userEmail: email }, { ownerEmail: email }],
    })
      .select({ _id: 1 })
      .lean();

    const leadIds = leads.map((lead: any) => lead._id);
    let enrollmentCancelResult = { matchedCount: 0, modifiedCount: 0 };
    if (leadIds.length) {
      enrollmentCancelResult = await DripEnrollment.updateMany(
        {
          userEmail: email,
          leadId: { $in: leadIds },
          campaignId: campaignObjectId,
          status: { $in: ["active", "paused"] },
        },
        {
          $set: {
            status: "canceled",
            nextSendAt: null,
            isActive: false,
            isPaused: true,
            stopAll: true,
            active: false,
            enabled: false,
          },
          $unset: {
            processing: 1,
            processingAt: 1,
          },
        }
      );
    }

    return res.status(200).json({
      success: true,
      matched: upd.matchedCount,
      modified: upd.modifiedCount,
      canceledEnrollments: enrollmentCancelResult.modifiedCount,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}
