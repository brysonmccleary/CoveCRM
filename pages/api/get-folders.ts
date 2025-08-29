// pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

const SYSTEM_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"]; // keep your order

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

    // Ensure system folders exist (idempotent)
    for (const name of SYSTEM_FOLDERS) {
      const exists = await Folder.findOne({ userEmail: email, name }).lean();
      if (!exists) await Folder.create({ userEmail: email, name, assignedDrips: [] });
    }

    // Only this user's folders
    const rawFolders = (await Folder.find({ userEmail: email }).sort({ createdAt: -1 }).lean()) as any as LeanFolder[];

    // Separate custom vs system
    const custom: LeanFolder[] = [];
    const system: LeanFolder[] = [];
    for (const f of rawFolders) {
      (SYSTEM_FOLDERS.includes(f.name) ? system : custom).push(f);
    }

    // ORDER: custom (alpha), then system in fixed order
    custom.sort((a, b) => a.name.localeCompare(b.name));
    system.sort((a, b) => SYSTEM_FOLDERS.indexOf(a.name) - SYSTEM_FOLDERS.indexOf(b.name));
    const ordered = [...custom, ...system];

    const idStrs = ordered.map((f) => String(f._id));
    const nameLowers = ordered.map((f) => f.name.toLowerCase());

    // A) counts by folderId (canonical)
    const countsByIdAgg = await Lead.aggregate([
      { $match: { userEmail: email, folderId: { $exists: true, $ne: null } } },
      { $project: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
      { $match: { _id: { $in: idStrs } } },
    ]);
    const countsById = new Map<string, number>();
    for (const r of countsByIdAgg) countsById.set(String(r._id), r.n as number);

    // B) legacy name counts ONLY for docs with no folderId
    const countsByNameAgg = await Lead.aggregate([
      {
        $match: {
          userEmail: email,
          $or: [{ folderId: { $exists: false } }, { folderId: null }],
        },
      },
      {
        $project: {
          nameRaw: {
            $ifNull: ["$folderName", { $ifNull: ["$Folder", { $ifNull: ["$Folder Name", null] }] }],
          },
        },
      },
      { $match: { nameRaw: { $type: "string" } } },
      { $group: { _id: { $toLower: { $trim: { input: "$nameRaw" } } }, n: { $sum: 1 } } },
      { $match: { _id: { $in: nameLowers } } },
    ]);
    const countsByName = new Map<string, number>();
    for (const r of countsByNameAgg) countsByName.set(String(r._id), r.n as number);

    // Build response
    const foldersWithCounts = ordered.map((f) => {
      const id = String(f._id);
      const nameLc = f.name.toLowerCase();
      const byId = countsById.get(id) || 0;
      const byName = countsByName.get(nameLc) || 0;
      return { ...f, _id: id, leadCount: byId + byName };
    });

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
