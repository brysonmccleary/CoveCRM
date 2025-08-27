// pages/api/get-folder-counts.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { Types } from "mongoose";

const SYSTEM = ["Not Interested", "Booked Appointment", "Sold", "Unsorted"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  try {
    const session = await getServerSession(req, res, authOptions);
    const userEmail = session?.user?.email?.toLowerCase();
    if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // Make sure system folders exist (cheap upsert)
    await Promise.all(
      SYSTEM.map((name) =>
        Folder.updateOne({ userEmail, name }, { $setOnInsert: { userEmail, name } }, { upsert: true })
      )
    );

    const folders = await Folder.find({ userEmail }).select({ _id: 1, name: 1 }).lean();

    const pairs = await Promise.all(
      folders.map(async (f) => {
        const id = f._id as Types.ObjectId;
        const idStr = String(id);
        const nameLc = (f.name || "").toLowerCase();

        const count = await Lead.countDocuments({
          userEmail,
          $or: [
            { folderId: id },
            { folderId: idStr },
            { $expr: { $eq: [{ $toString: "$folderId" }, idStr] } },
            {
              $and: [
                { $or: [{ folderId: { $exists: false } }, { folderId: null }] },
                {
                  $or: [
                    { $expr: { $eq: [{ $toLower: "$status" }, nameLc] } },
                    { $expr: { $eq: [{ $toLower: "$folderName" }, nameLc] } },
                    { $expr: { $eq: [{ $toLower: "$Folder" }, nameLc] } },
                    { $expr: { $eq: [{ $toLower: { $ifNull: ["$Folder Name", ""] } }, nameLc] } },
                  ],
                },
              ],
            },
          ],
        });

        return [String(f._id), count] as const;
      })
    );

    const counts: Record<string, number> = {};
    pairs.forEach(([id, n]) => (counts[id] = n));

    res.status(200).json({ counts });
  } catch (e) {
    console.error("get-folder-counts error:", e);
    res.status(500).json({ message: "Failed to build counts" });
  }
}
