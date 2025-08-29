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

    // Ensure standard system folders exist (idempotent, do NOT auto-create Unsorted here)
    for (const name of SYSTEM_FOLDERS) {
      const exists = await Folder.findOne({ userEmail: email, name }).lean();
      if (!exists) await Folder.create({ userEmail: email, name, assignedDrips: [] });
    }

    // Fetch all folders for user
    const rawFolders = (await Folder.find({ userEmail: email })
      .sort({ createdAt: -1 })
      .lean()) as any as LeanFolder[];

    // Determine canonical "Unsorted" (first created) if present; create if user already has many null-folder leads
    const unsortedName = "Unsorted";
    let unsortedFolders = rawFolders.filter((f) => String(f.name).toLowerCase() === "unsorted");
    let unsortedCanonical: LeanFolder | null = null;

    if (unsortedFolders.length > 0) {
      unsortedFolders.sort((a, b) => {
        const ad = new Date(a.createdAt || 0).getTime();
        const bd = new Date(b.createdAt || 0).getTime();
        return ad - bd || String(a._id).localeCompare(String(b._id));
      });
      unsortedCanonical = unsortedFolders[0];
    }

    // Count by *folderId only* (canonical path)
    const countsByIdAgg = await Lead.aggregate([
      { $match: { userEmail: email, folderId: { $exists: true, $ne: null } } },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);

    const countsById = new Map<string, number>();
    for (const r of countsByIdAgg) countsById.set(String(r._id), r.n as number);

    // Count all *unassigned* (no folderId) -> these should appear ONLY under canonical "Unsorted"
    const unsortedCount = await Lead.countDocuments({
      userEmail: email,
      $or: [{ folderId: { $exists: false } }, { folderId: null }],
    });

    // If we have unassigned leads but no Unsorted folder at all, create one so the user can click into it
    if (unsortedCount > 0 && !unsortedCanonical) {
      const created = await Folder.create({ userEmail: email, name: unsortedName, assignedDrips: [] });
      unsortedCanonical = created.toObject();
      unsortedFolders = [unsortedCanonical as any];
    }

    // Order: custom (alpha) then system (fixed order). Keep duplicates if they exist.
    const custom: LeanFolder[] = [];
    const system: LeanFolder[] = [];

    for (const f of rawFolders) {
      (SYSTEM_FOLDERS.includes(f.name) ? system : custom).push(f);
    }

    custom.sort((a, b) => a.name.localeCompare(b.name));
    system.sort((a, b) => SYSTEM_FOLDERS.indexOf(a.name) - SYSTEM_FOLDERS.indexOf(b.name));

    const ordered = [...custom, ...system];

    const unsortedCanonicalIdStr = unsortedCanonical ? String(unsortedCanonical._id) : null;

    const foldersWithCounts = ordered.map((f) => {
      const idStr = String(f._id);
      const byId = countsById.get(idStr) || 0;
      const extraUnsorted =
        unsortedCanonicalIdStr && idStr === unsortedCanonicalIdStr ? unsortedCount : 0;
      return { ...f, _id: idStr, leadCount: byId + extraUnsorted };
    });

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
