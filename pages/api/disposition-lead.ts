// /pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/folder"; // keep your existing import path/casing

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { leadId, newFolderName } = req.body as { leadId?: string; newFolderName?: string };
  if (!leadId || !newFolderName) {
    res.status(400).json({ message: "Missing required fields." });
    return;
  }

  try {
    await dbConnect();

    // Ensure the lead belongs to this user
    const lead = await Lead.findOne({ _id: leadId, userEmail });
    if (!lead) {
      res.status(404).json({ message: "Lead not found." });
      return;
    }

    // Ensure folder exists for this user
    let folder = await Folder.findOne({ userEmail, name: newFolderName });
    if (!folder) {
      folder = await Folder.create({ userEmail, name: newFolderName });
    }

    // Move lead and set status (for system folders)
    lead.folderId = folder._id;
    lead.status = newFolderName;
    await lead.save();

    // NEW: write a history entry so the feed shows the disposition
    await Lead.updateOne(
      { _id: lead._id, userEmail },
      {
        $push: {
          interactionHistory: {
            type: "outbound",
            text: `✅ Disposition: ${newFolderName}`,
            date: new Date(),
          },
        },
      }
    );

    res.status(200).json({
      success: true,
      message: "Lead moved successfully.",
      folderId: String(folder._id),
    });
    return;
  } catch (error) {
    console.error("Disposition error:", error);
    res.status(500).json({ message: "Internal server error." });
    return;
  }
}
