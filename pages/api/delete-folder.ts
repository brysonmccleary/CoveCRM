// /pages/api/delete-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ✅ Changed from DELETE to POST to match frontend call
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const userEmail = session.user.email.toLowerCase();
  const { folderId } = req.body; // ✅ Use body instead of query

  if (!folderId || typeof folderId !== "string") {
    return res.status(400).json({ message: "Invalid folderId" });
  }

  try {
    await dbConnect();

    const folder = await Folder.findOneAndDelete({ _id: folderId, userEmail });
    if (!folder) {
      return res.status(404).json({ message: "Folder not found or already deleted" });
    }

    // Remove all leads in that folder
    const leadDelete = await Lead.deleteMany({ folderId: folder._id, userEmail });

    console.log(`🗑 Deleted folder '${folder.name}' and ${leadDelete.deletedCount} leads`);
    return res.status(200).json({ success: true, message: "Folder and leads deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting folder:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
