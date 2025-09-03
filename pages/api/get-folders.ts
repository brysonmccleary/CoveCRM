// pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

const SYSTEM_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"];

type LeanFolder = {
  _id: Types.ObjectId | string;
  name: string;
  userEmail: string;
  assignedDrips?: any[];
  createdAt?: Date;
  updatedAt?: Date;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // Ensure required system folders exist for this user (idempotent)
    for (const name of SYSTEM_FOLDERS) {
      const exists = await Folder.findOne({ userEmail: email, name }).lean();
      if (!exists) {
        await Folder.create({ userEmail: email, name, assignedDrips: [] });
      }
    }

    const rawFolders = (await Folder.find({ userEmail: email }).sort({ createdAt: -1 }).lean()) as any as LeanFolder[];

    // If an "Unsorted" folder exists, treat it as the sink for no-folder leads
    const unsorted = rawFolders
      .filter((f) => String(f.name).toLowerCase() === "unsorted")
      .sort((a, b) => {
        const ad = new Date(a.createdAt || 0).getTime();
        const bd = new Date(b.createdAt || 0).getTime();
        return ad - bd || String(a._id).localeCompare(String(b._id));
      })[0] as LeanFolder | undefined;
    const unsortedIdStr = unsorted ? String(unsorted._id) : null;

    // Exact counts by folderId (strict)
    const byIdAgg = await Lead.aggregate([
      { $match: { userEmail: email, folderId: { $exists: true, $ne: null } } },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);
    const byId = new Map<string, number>();
    for (const r of byIdAgg) byId.set(String(r._id), r.n as number);

    // Leads without a folderId
    const unsortedCount = await Lead.countDocuments({
      userEmail: email,
      $or: [{ folderId: { $exists: false } }, { folderId: null }],
    });

    // Order: custom (alpha) then fixed system order
    const custom: LeanFolder[] = [];
    const system: LeanFolder[] = [];
    for (const f of rawFolders) (SYSTEM_FOLDERS.includes(f.name) ? system : custom).push(f);
    custom.sort((a, b) => a.name.localeCompare(b.name));
    system.sort((a, b) => SYSTEM_FOLDERS.indexOf(a.name) - SYSTEM_FOLDERS.indexOf(b.name));
    const ordered = [...custom, ...system];

    const foldersWithCounts = ordered.map((f) => {
      const idStr = String(f._id);
      const count = (byId.get(idStr) || 0) + (unsortedIdStr && idStr === unsortedIdStr ? unsortedCount : 0);
      return { ...f, _id: idStr, leadCount: count };
    });

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
