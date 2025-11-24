// pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

const SYSTEM = ["Sold", "Not Interested", "Booked Appointment"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    const email =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";

    if (!email) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await mongooseConnect();

    // 1) Make sure THIS user has their own system folders (per-user, scoped by userEmail)
    await Promise.all(
      SYSTEM.map((name) =>
        Folder.updateOne(
          { userEmail: email, name },
          { $setOnInsert: { userEmail: email, name, assignedDrips: [] } },
          { upsert: true }
        )
      )
    );

    // 2) Fetch ONLY this user's folders
    const rawFolders = await Folder.find({ userEmail: email })
      .select({ _id: 1, name: 1 })
      .lean();

    // 3) Build lead counts per folder using the same logic as get-folder-counts
    const pairs = await Promise.all(
      rawFolders.map(async (f) => {
        const id = f._id as Types.ObjectId;
        const idStr = String(id);
        const nameLc = (f.name || "").toLowerCase();

        const count = await Lead.countDocuments({
          userEmail: email,
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
                    {
                      $expr: {
                        $eq: [
                          { $toLower: { $ifNull: ["$Folder Name", ""] } },
                          nameLc,
                        ],
                      },
                    },
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
    pairs.forEach(([id, n]) => {
      counts[id] = n;
    });

    const folders = rawFolders.map((f) => ({
      _id: String(f._id),
      name: f.name,
      userEmail: email,
      leadCount: counts[String(f._id)] ?? 0,
    }));

    return res.status(200).json({ folders });
  } catch (err) {
    console.error("get-folders error:", err);
    return res.status(500).json({ message: "Error fetching folders" });
  }
}
