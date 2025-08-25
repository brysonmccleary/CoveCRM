// pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

type LeanFolder = {
  _id: Types.ObjectId | string;
  name: string;
  userEmail: string;
  assignedDrips?: any[];
  createdAt?: Date;
  updatedAt?: Date;
};

const SYSTEM_DEFAULTS = ["Sold", "Not Interested", "Booked Appointment"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // Ensure the three system folders exist for this user (once).
    for (const name of SYSTEM_DEFAULTS) {
      await Folder.updateOne(
        { userEmail: email, name },
        { $setOnInsert: { userEmail: email, name, assignedDrips: [] } },
        { upsert: true }
      );
    }

    // Load ONLY this user's folders
    const rawFolders = (await Folder.find({ userEmail: email })
      .sort({ createdAt: -1 })
      .lean()) as LeanFolder[];

    // De-duplicate by name (case-insensitive) just for display to avoid doubles.
    const byName = new Map<string, LeanFolder>();
    for (const f of rawFolders) {
      const key = (f.name || "").trim().toLowerCase();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, f); // keep most-recent (because of sort above)
    }
    const folders = Array.from(byName.values());

    // Build accurate counts: match user, require folderId set,
    // coerce folderId to string for consistent grouping,
    // and count per folderId.
    const countsAgg = await Lead.aggregate([
      {
        $match: {
          $or: [{ userEmail: email }, { user: email }],
          folderId: { $exists: true, $ne: null },
        },
      },
      {
        $project: {
          folderIdStr: {
            $cond: [
              { $eq: [{ $type: "$folderId" }, "objectId"] },
              { $toString: "$folderId" },
              "$folderId",
            ],
          },
        },
      },
      { $group: { _id: "$folderIdStr", count: { $sum: 1 } } },
    ]);

    const countMap = new Map<string, number>();
    for (const row of countsAgg) {
      countMap.set(String(row._id), row.count as number);
    }

    // Sort: custom (imported) first, then system folders.
    // Within each group, keep newest first.
    const sorted = folders.sort((a, b) => {
      const aIsSystem = SYSTEM_DEFAULTS.includes(a.name);
      const bIsSystem = SYSTEM_DEFAULTS.includes(b.name);
      if (aIsSystem !== bIsSystem) return aIsSystem ? 1 : -1; // custom first
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });

    const result = sorted.map((f) => {
      const idStr = String(f._id);
      return {
        _id: idStr,
        name: f.name,
        userEmail: f.userEmail,
        assignedDrips: f.assignedDrips || [],
        leadCount: countMap.get(idStr) || 0,
      };
    });

    return res.status(200).json({ folders: result });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
