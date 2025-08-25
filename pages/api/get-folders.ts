// pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";

const DEFAULT_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"];

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

    // Create per-user default folders if missing (only by userEmail)
    for (const name of DEFAULT_FOLDERS) {
      const exists = await Folder.findOne({ name, userEmail }).select("_id").lean();
      if (!exists) await Folder.create({ name, userEmail, assignedDrips: [] });
    }

    // Only this user's folders (no legacy "user" key — we are email-only)
    const folders = await Folder.find({ userEmail }).sort({ createdAt: -1 }).lean();

    // Count leads per folder:
    //  - Canonical: folderId == folder._id
    //  - Legacy:    NO folderId (missing/null) AND name matches this folder (folderName | Folder | "Folder Name")
    const foldersWithCounts = await Promise.all(
      folders.map(async (folder) => {
        const nameRegex = eqi(folder.name);

        const count = await Lead.countDocuments({
          userEmail,
          $or: [
            // Canonical ID assignment
            { folderId: folder._id },

            // Legacy name-based assignment ONLY when folderId absent
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
          _id: folder._id.toString(),
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
