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

    // Ensure default folders exist for THIS user only (don’t create global dupes)
    for (const name of DEFAULT_FOLDERS) {
      const exists = await Folder.findOne({ name, userEmail: email }).select("_id").lean();
      if (!exists) await Folder.create({ name, userEmail: email, assignedDrips: [] });
    }

    // Load user + global folders, but de-dupe by name (user folder wins)
    const [userFolders, globalFolders] = await Promise.all([
      Folder.find({ userEmail: email }).sort({ createdAt: -1 }).lean(),
      Folder.find({ userEmail: { $exists: false } }).sort({ createdAt: -1 }).lean(),
    ]);
    const byName = new Map<string, any>();
    for (const f of userFolders) byName.set(norm(f.name), f);
    for (const f of globalFolders) if (!byName.has(norm(f.name))) byName.set(norm(f.name), f);
    const folders = Array.from(byName.values());

    // For each folder, count ONLY the leads that belong to it.
    //  - canonical: folderId === this folder _id
    //  - legacy:    no folderId AND name matches exactly (case-insensitive) in old fields
    const results = await Promise.all(
      folders.map(async (f) => {
        const [byId, byLegacy] = await Promise.all([
          Lead.countDocuments({
            ...userMatch(email),
            folderId: f._id,
          }),
          Lead.countDocuments({
            ...userMatch(email),
            $and: [
              { $or: [{ folderId: { $exists: false } }, { folderId: null }] },
              {
                $or: [
                  { folderName: f.name },
                  { Folder: f.name },
                  { ["Folder Name"]: f.name },
                ],
              },
            ],
          }),
        ]);

        return {
          _id: String(f._id),
          name: f.name,
          leadCount: byId + byLegacy,
        };
      })
    );

    return res.status(200).json({ folders: results });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
