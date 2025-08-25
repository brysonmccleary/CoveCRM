import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

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

    // A) counts by folderId (canonical)
    const idAgg = await Lead.aggregate([
      { $match: { ...userMatch(email), folderId: { $exists: true, $ne: null } } },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]).exec();
    const countsById: Record<string, number> = {};
    for (const c of idAgg) countsById[String(c._id)] = c.count;

    // B) counts by legacy folder name, ONLY where folderId is missing/null
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
    const countsByName: Record<string, number> = {};
    for (const c of nameAgg) countsByName[String(c._id)] = c.count;

    return res.status(200).json({ countsById, countsByName });
  } catch (err) {
    console.error("Error fetching folder counts:", err);
    res.status(500).json({ message: "Error fetching folder counts" });
  }
}
