import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";

const DEFAULT_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // 1) Ensure defaults exist, but DO NOT duplicate if a global with same name exists
    for (const name of DEFAULT_FOLDERS) {
      const exists = await Folder.findOne({
        name,
        $or: [{ userEmail: email }, { userEmail: { $exists: false } }],
      })
        .select("_id")
        .lean()
        .exec();

      if (!exists) {
        await Folder.create({ name, userEmail: email, assignedDrips: [] });
      }
    }

    // 2) Fetch user-specific + global
    const [userFolders, globalFolders] = await Promise.all([
      Folder.find({ userEmail: email }).sort({ createdAt: -1 }).lean().exec(),
      Folder.find({ userEmail: { $exists: false } }).sort({ createdAt: -1 }).lean().exec(),
    ]);

    // 3) Dedupe by normalized name (prefer user's copy over global)
    const byName = new Map<string, any>();
    const norm = (s: string) => String(s || "").trim().toLowerCase();

    for (const f of userFolders) byName.set(norm(f.name), f);
    for (const f of globalFolders) {
      const k = norm(f.name);
      if (!byName.has(k)) byName.set(k, f);
    }

    const folders = Array.from(byName.values());

    // 4) Count leads per folder for THIS user (support userEmail/ownerEmail/user)
    const counts = await Lead.aggregate([
      {
        $match: {
          $or: [{ userEmail: email }, { ownerEmail: email }, { user: email }],
          folderId: { $exists: true, $ne: null },
        },
      },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]).exec();

    const countById = new Map<string, number>();
    for (const c of counts) countById.set(String(c._id), c.count);

    // 5) Shape response for the UI
    const result = folders.map((f: any) => ({
      _id: String(f._id),
      name: f.name,
      leadCount: countById.get(String(f._id)) || 0,
    }));

    return res.status(200).json({ folders: result });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
