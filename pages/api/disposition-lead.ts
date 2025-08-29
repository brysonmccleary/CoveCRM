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

    // --- FIX: resolve canonical folder (handles duplicates) ---
    const nameTrimmed = newFolderName.trim();
    const escaped = nameTrimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape for regex
    // Find all same-name folders (case-insensitive) for this user, pick the NEWEST one.
    const candidates = await Folder.find({
      userEmail,
      name: { $regex: new RegExp(`^${escaped}$`, "i") },
    })
      .sort({ createdAt: -1, _id: -1 })
      .select({ _id: 1, name: 1 })
      .lean();

    let targetFolderId: any;
    let targetFolderName = nameTrimmed;

    if (candidates.length > 0) {
      targetFolderId = candidates[0]._id;
      targetFolderName = candidates[0].name ?? nameTrimmed;
    } else {
      const created = await Folder.create({ userEmail, name: nameTrimmed, assignedDrips: [] });
      targetFolderId = created._id;
      targetFolderName = created.name;
    }
    // ----------------------------------------------------------

    const fromFolderId = lead.folderId ? String(lead.folderId) : null;

    // Move + keep backward-compat fields in sync
    lead.folderId = targetFolderId;
    (lead as any).folder = targetFolderName;         // legacy
    (lead as any)["Folder Name"] = targetFolderName; // legacy
    (lead as any).folderName = targetFolderName;     // friendly alias

    if (SYSTEM.has(targetFolderName)) {
      lead.status = targetFolderName; // mark disposition as status
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
            to: targetFolderName,
            date: new Date(),
          },
        },
      }
    );

    // Socket notify (refresh lists)
    try {
      let io = (res as any)?.socket?.server?.io;
      if (!io) io = initSocket(res as any);
      if (io) {
        io.to(userEmail).emit("lead:updated", {
          _id: String(lead._id),
          folderId: String(targetFolderId),
          folder: targetFolderName,
          folderName: targetFolderName,
          ["Folder Name"]: targetFolderName,
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
      toFolderId: String(targetFolderId),
      status: lead.status,
      folderName: targetFolderName,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
