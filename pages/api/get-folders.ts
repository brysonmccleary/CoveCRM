import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";

const DEFAULT_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"];

const norm = (s: string) => String(s || "").trim().toLowerCase();
const userMatch = (email: string) => ({
  $or: [{ userEmail: email }, { ownerEmail: email }, { user: email }],
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // 1) Ensure defaults exist for this user (avoid duplicates: check user + global)
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

    // 2) Load user + global folders and dedupe by name (user copy wins)
    const [userFolders, globalFolders] = await Promise.all([
      Folder.find({ userEmail: email }).sort({ createdAt: -1 }).lean().exec(),
      Folder.find({ userEmail: { $exists: false } }).sort({ createdAt: -1 }).lean().exec(),
    ]);
    const byName = new Map<string, any>();
    for (const f of userFolders) byName.set(norm(f.name), f);
    for (const f of globalFolders) if (!byName.has(norm(f.name))) byName.set(norm(f.name), f);
    const folders = Array.from(byName.values());

    // 3) Counts for leads WITH folderId (canonical)
    const idAgg = await Lead.aggregate([
      { $match: { ...userMatch(email), folderId: { $exists: true, $ne: null } } },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]).exec();
    const countById = new Map<string, number>();
    for (const c of idAgg) countById.set(String(c._id), c.count);

    // 4) Counts for legacy/imported leads that have NO folderId but DO have a matching folder name
    const nameAgg = await Lead.aggregate([
      { $match: { ...userMatch(email), $or: [{ folderId: { $exists: false } }, { folderId: null }] } },
      {
        $project: {
          nameRaw: {
            $ifNull: [
              "$folderName",
              { $ifNull: ["$Folder", { $getField: { input: "$$ROOT", field: "Folder Name" } }] },
            ],
          },
        },
      },
      { $match: { nameRaw: { $ne: null, $type: "string" } } },
      { $group: { _id: { $toLower: { $trim: { input: "$nameRaw" } } }, count: { $sum: 1 } } },
    ]).exec();
    const countByName = new Map<string, number>();
    for (const c of nameAgg) countByName.set(String(c._id), c.count);

    // 5) Build response: for each folder, count = idCount + legacyNameCount(no-folderId)
    const result = folders.map((f: any) => {
      const idCount = countById.get(String(f._id)) || 0;
      const legacyCount = countByName.get(norm(f.name)) || 0;
      return { _id: String(f._id), name: f.name, leadCount: idCount + legacyCount };
    });

    return res.status(200).json({ folders: result });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
