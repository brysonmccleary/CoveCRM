import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { leadId, newFolderName } = req.body;

  if (!leadId || !newFolderName) {
    return res
      .status(400)
      .json({ message: "leadId and newFolderName are required" });
  }

  try {
    await dbConnect();
    console.log("✅ Connected to DB (move-lead-folder)");

    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userEmail = session.user.email;

    // ✅ Find or create folder for this user
    let folder = await Folder.findOne({ name: newFolderName, userEmail });
    if (!folder) {
      folder = new Folder({
        name: newFolderName,
        userEmail,
        assignedDrips: [],
        createdAt: new Date(),
      });
      await folder.save();
      console.log(`✅ Created folder '${newFolderName}' for ${userEmail}`);
    }

    // ✅ Update lead to move to new folder (main fix: use userEmail)
    const lead = await Lead.findOneAndUpdate(
      { _id: leadId, userEmail },
      { folderId: folder._id },
      { new: true },
    );

    if (!lead) {
      return res
        .status(404)
        .json({ message: "Lead not found or does not belong to this user" });
    }

    console.log(
      `✅ Lead ${leadId} moved to '${newFolderName}' for ${userEmail}`,
    );
    res.status(200).json({ message: "Lead moved successfully" });
  } catch (error) {
    console.error("Move lead error:", error);
    res.status(500).json({ message: "Error moving lead" });
  }
}
