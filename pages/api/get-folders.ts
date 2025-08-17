import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";

const defaultFolders = ["Sold", "Not Interested", "Booked Appointment"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userEmail = session.user.email.toLowerCase(); // ensure lowercase match
    await dbConnect();
    console.log("✅ Connected to DB (get-folders)");

    // Ensure default folders exist for this user
    for (const folderName of defaultFolders) {
      const exists = await Folder.findOne({ name: folderName, userEmail });
      if (!exists) {
        await new Folder({ name: folderName, userEmail, assignedDrips: [] }).save();
        console.log(`✅ Created default folder '${folderName}' for ${userEmail}`);
      }
    }

    // Fetch all folders that are either user-specific or global
    const userFolders = await Folder.find({ userEmail }).sort({ createdAt: -1 });
    const globalFolders = await Folder.find({ userEmail: { $exists: false } }).sort({ createdAt: -1 });

    const allFolders = [...userFolders, ...globalFolders];

    const foldersWithCounts = await Promise.all(
      allFolders.map(async (folder) => {
        const leadCount = await Lead.countDocuments({
          folderId: folder._id,
          userEmail,
        });

        return {
          ...folder.toObject(),
          _id: folder._id.toString(),
          leadCount,
        };
      })
    );

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}
