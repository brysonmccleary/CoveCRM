// pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { initSocket } from "@/lib/socket";

const SYSTEM = new Set(["Not Interested", "Booked Appointment", "Sold", "Resolved"]);

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

    // Resolve a *canonical* target folder:
    // - case-insensitive exact name match
    // - oldest first (createdAt, then _id) to avoid duplicates picking the wrong one
    const targetName = newFolderName.trim();
    let folder =
      (await Folder.findOne({
        userEmail,
        name: new RegExp(`^${targetName}$`, "i"),
      })
        .sort({ createdAt: 1, _id: 1 })
        .exec()) || null;

    // Create if none exists
    if (!folder) {
      folder = await Folder.create({ userEmail, name: targetName, assignedDrips: [] });
    }

    const fromFolderId = lead.folderId ? String(lead.folderId) : null;

    // Move + keep backward-compat fields in sync
    lead.folderId = folder._id;
    (lead as any).folder = targetName;           // legacy
    (lead as any)["Folder Name"] = targetName;   // legacy
    (lead as any).folderName = targetName;       // friendly alias

    if (SYSTEM.has(targetName)) {
      lead.status = targetName; // disposition mirrors status
    }

    lead.updatedAt = new Date();
    await lead.save();

    // Visible history entry
    await Lead.updateOne(
      { _id: lead._id, userEmail },
      {
        $push: {
          interactionHistory: {
            type: "status",
            from: fromFolderId,
            to: targetName,
            date: new Date(),
          },
        },
      }
    );

    // Notify any open UIs
    try {
      let io = (res as any)?.socket?.server?.io;
      if (!io) io = initSocket(res as any);
      if (io) {
        io.to(userEmail).emit("lead:updated", {
          _id: String(lead._id),
          folderId: String(folder._id),
          folder: targetName,
          folderName: targetName,
          ["Folder Name"]: targetName,
          status: lead.status,
          updatedAt: lead.updatedAt,
        });
      }
    } catch (e) {
      console.warn("disposition-lead: socket emit failed (non-fatal):", e);
    }

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      fromFolderId,
      toFolderId: String(folder._id),
      status: lead.status,
      folderName: targetName,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
