import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, newFolderName } = (req.body ?? {}) as { leadId?: string; newFolderName?: string };
  if (!leadId || !newFolderName?.trim()) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  try {
    await dbConnect();

    // Ensure this is your lead
    const lead = await Lead.findOne({ _id: leadId, userEmail });
    if (!lead) return res.status(404).json({ message: "Lead not found." });

    // Ensure target folder exists (by name, scoped to user)
    let folder = await Folder.findOne({ userEmail, name: newFolderName });
    if (!folder) folder = await Folder.create({ userEmail, name: newFolderName, assignedDrips: [] });

    // Move + ALWAYS sync status with the folder name (per acceptance criteria)
    const fromFolderId = lead.folderId ? String(lead.folderId) : null;
    lead.folderId = folder._id;
    lead.status = newFolderName;        // <- surgical change
    await lead.save();

    // History entry (best-effort)
    await Lead.updateOne(
      { _id: lead._id, userEmail },
      {
        $push: {
          interactionHistory: {
            type: "status",
            from: fromFolderId,
            to: newFolderName,
            date: new Date(),
          },
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      fromFolderId,
      toFolderId: String(folder._id),
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
