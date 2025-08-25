// pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

const DEFAULT_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"];

type LeanFolder = {
  _id: Types.ObjectId | string;
  name: string;
  userEmail: string;
  assignedDrips?: any[];
} & Record<string, any>;

// Escape a string for safe use inside a RegExp
function escapeRegExp(s: string) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a strict, case-insensitive equality regex (ignores surrounding spaces)
function eqi(name: string) {
  return new RegExp(`^\\s*${escapeRegExp(String(name || ""))}\\s*$`, "i");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const userEmail =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // Create per-user default folders if missing (email-scoped only)
    for (const name of DEFAULT_FOLDERS) {
      const exists = await Folder.findOne({ name, userEmail }).select("_id").lean();
      if (!exists) await Folder.create({ name, userEmail, assignedDrips: [] });
    }

    // Only this user's folders
    const raw = await Folder.find({ userEmail }).sort({ createdAt: -1 }).lean();
    const folders = raw as unknown as LeanFolder[];

    const foldersWithCounts = await Promise.all(
      folders.map(async (folder) => {
        const folderIdObj = new Types.ObjectId(String(folder._id)); // normalize for ObjectId comparisons
        const nameRegex = eqi(folder.name);

        const count = await Lead.countDocuments({
          userEmail,
          $or: [
            // Canonical ID assignment (cover ObjectId or possible string-stored id)
            { folderId: folderIdObj },
            { folderId: String(folder._id) },

            // Legacy name-based assignment ONLY when folderId is missing/null
            {
              $and: [
                { $or: [{ folderId: { $exists: false } }, { folderId: null }] },
                {
                  $or: [
                    { folderName: nameRegex },
                    { Folder: nameRegex },
                    { ["Folder Name"]: nameRegex },
                  ],
                },
              ],
            },
          ],
        });

        return {
          ...folder,
          _id: String(folder._id),
          leadCount: count,
        };
      })
    );

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
