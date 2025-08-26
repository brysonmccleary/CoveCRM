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

    // Ensure system folders exist for this user (idempotent)
    for (const name of SYSTEM_FOLDERS) {
      const exists = await Folder.findOne({ userEmail: email, name }).lean();
      if (!exists) {
        await Folder.create({ userEmail: email, name, assignedDrips: [] });
      }
    }

    // Only this user's folders
    const rawFolders = (await Folder.find({ userEmail: email })
      .sort({ createdAt: -1 })
      .lean()) as any as LeanFolder[];

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

    // Build list of folder ids as strings for robust matching
    const idStrs = ordered.map((f) => String(f._id));

    // STRICT + ROBUST COUNTS by { userEmail, folderId } with type normalization
    const countsAgg = await Lead.aggregate([
      { $match: { userEmail: email } },
      { $group: { _id: { $toString: "$folderId" }, n: { $sum: 1 } } },
      { $match: { _id: { $in: idStrs } } },
    ]);

    const countsMap = new Map<string, number>();
    for (const row of countsAgg) {
      countsMap.set(String(row._id), row.n as number);
    }

    const foldersWithCounts = ordered.map((f) => ({
      ...f,
      _id: String(f._id),
      leadCount: countsMap.get(String(f._id)) || 0,
    }));

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
