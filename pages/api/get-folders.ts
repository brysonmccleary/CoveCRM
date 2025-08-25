import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

const DEFAULT_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"];

// Normalize for name comparisons
function normName(s: string) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const userEmail =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // Ensure per-user defaults exist (email scoped)
    for (const name of DEFAULT_FOLDERS) {
      const exists = await Folder.findOne({ userEmail, name }).select("_id").lean();
      if (!exists) await Folder.create({ name, userEmail, assignedDrips: [] });
    }

    // Load all this user's folders
    const folders = await Folder.find({ userEmail }).sort({ createdAt: 1 }).lean();

    // ----- One-time self-healing: dedupe same-name folders for this user -----
    const mapByName = new Map<string, any[]>();
    for (const f of folders) {
      const key = normName(f.name);
      mapByName.set(key, [...(mapByName.get(key) || []), f]);
    }

    for (const [_, arr] of mapByName.entries()) {
      if (arr.length <= 1) continue;

      // Keep the earliest created; merge others into it
      const primary = arr[0];
      const dups = arr.slice(1);
      const primaryId = new Types.ObjectId(String(primary._id));

      for (const dup of dups) {
        const dupId = new Types.ObjectId(String(dup._id));
        // move leads from dup -> primary
        await Lead.updateMany(
          { userEmail, folderId: dupId },
          { $set: { folderId: primaryId } }
        );
        // delete dup folder
        await Folder.deleteOne({ _id: dupId, userEmail });
      }
    }

    // Re-load after dedupe
    const cleanFolders = await Folder.find({ userEmail }).sort({ createdAt: 1 }).lean();

    // STRICT counts: only folderId === folder._id (no legacy name fallback here)
    const withCounts = await Promise.all(
      cleanFolders.map(async (f) => {
        const fIdObj = new Types.ObjectId(String(f._id));
        const count = await Lead.countDocuments({
          userEmail,
          $or: [{ folderId: fIdObj }, { folderId: String(f._id) }], // tolerate string-stored id
        });

        return {
          ...f,
          _id: String(f._id),
          leadCount: count,
        };
      })
    );

    return res.status(200).json({ folders: withCounts });
  } catch (err) {
    console.error("❌ get-folders error:", err);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
