// pages/api/get-folders.ts
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

    // Ensure user’s defaults exist (user-scoped only)
    for (const name of DEFAULT_FOLDERS) {
      const exists = await Folder.findOne({ name, userEmail: email }).select("_id").lean();
      if (!exists) await Folder.create({ name, userEmail: email, assignedDrips: [] });
    }

    // Load folders (prefer user’s versions by name; then fallback to global)
    const [userFolders, globalFolders] = await Promise.all([
      Folder.find({ userEmail: email }).sort({ createdAt: -1 }).lean(),
      Folder.find({ userEmail: { $exists: false } }).sort({ createdAt: -1 }).lean(),
    ]);
    const byName = new Map<string, any>();
    for (const f of userFolders) byName.set(norm(f.name), f);
    for (const f of globalFolders) if (!byName.has(norm(f.name))) byName.set(norm(f.name), f);
    const folders = Array.from(byName.values());

    // ===== 1) Counts by folderId (canonical) =====
    const canonicalCounts = await Lead.aggregate([
      { $match: { ...userMatch(email), folderId: { $exists: true, $ne: null } } },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]);
    const countsById = new Map<string, number>();
    for (const row of canonicalCounts) countsById.set(String(row._id), row.count || 0);

    // ===== 2) Legacy counts by legacy name (no folderId) =====
    const legacyCounts = await Lead.aggregate([
      { $match: { ...userMatch(email), $or: [{ folderId: { $exists: false } }, { folderId: null }] } },
      {
        $addFields: {
          _legacyRaw: {
            $ifNull: ["$folderName", { $ifNull: ["$Folder", "$$ROOT['Folder Name']"] }],
          },
        },
      },
      {
        $addFields: {
          _legacyNorm: {
            $toLower: {
              $trim: { input: { $ifNull: ["$_legacyRaw", ""] } },
            },
          },
        },
      },
      { $match: { _legacyNorm: { $ne: "" } } },
      { $group: { _id: "$_legacyNorm", count: { $sum: 1 } } },
    ]);
    const countsByLegacyName = new Map<string, number>();
    for (const row of legacyCounts) countsByLegacyName.set(String(row._id), row.count || 0);

    // Merge per folder (exact, no leakage)
    const results = folders.map((f) => {
      const idCount = countsById.get(String(f._id)) || 0;
      const legacyCount = countsByLegacyName.get(norm(f.name)) || 0;
      return {
        _id: String(f._id),
        name: f.name,
        leadCount: idCount + legacyCount,
      };
    });

    return res.status(200).json({ folders: results });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
