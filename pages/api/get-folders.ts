// pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";

type AnyDoc = Record<string, any>;

const SYSTEM_DEFAULTS = ["Sold", "Not Interested", "Booked Appointment"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // Ensure required system folders exist for this user
    for (const name of SYSTEM_DEFAULTS) {
      await Folder.updateOne(
        { userEmail: email, name },
        { $setOnInsert: { userEmail: email, name, assignedDrips: [] } },
        { upsert: true }
      );
    }

    // Load ONLY this user's folders (lean -> AnyDoc to avoid TS friction on strict:false schemas)
    const rawFolders: AnyDoc[] = await Folder.find({ userEmail: email })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    // De-duplicate by name (case-insensitive) to avoid doubles in UI
    const byName = new Map<string, AnyDoc>();
    for (const f of rawFolders) {
      const key = String(f?.name || "").trim().toLowerCase();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, f);
    }
    const folders: AnyDoc[] = Array.from(byName.values());

    // Build accurate counts: only this user's leads that HAVE a folderId
    const countsAgg: AnyDoc[] = await Lead.aggregate([
      {
        $match: {
          $or: [{ userEmail: email }, { user: email }], // support legacy "user"
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
    ]).exec();

    const countMap = new Map<string, number>();
    for (const r of countsAgg) countMap.set(String(r._id), Number(r.count) || 0);

    // Sort: custom/imported FIRST, system defaults AFTER (newest first within each bucket)
    const sorted = folders.sort((a, b) => {
      const aSystem = SYSTEM_DEFAULTS.includes(String(a.name));
      const bSystem = SYSTEM_DEFAULTS.includes(String(b.name));
      if (aSystem !== bSystem) return aSystem ? 1 : -1; // custom first
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });

    const result = sorted.map((f) => {
      const idStr = String(f._id);
      return {
        _id: idStr,
        name: String(f.name || ""),
        userEmail: String(f.userEmail || email),
        assignedDrips: Array.isArray(f.assignedDrips) ? f.assignedDrips : [],
        leadCount: countMap.get(idStr) || 0,
      };
    });

    return res.status(200).json({ folders: result });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
