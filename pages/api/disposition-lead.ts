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
  if (!leadId || !newFolderName?.trim()) return res.status(400).json({ message: "Missing required fields." });

  try {
    await dbConnect();

    // Ensure ownership
    const lead = await Lead.findOne({ _id: leadId, userEmail });
    if (!lead) return res.status(404).json({ message: "Lead not found." });

    // Ensure target folder exists
    let folder = await Folder.findOne({ userEmail, name: newFolderName });
    if (!folder) folder = await Folder.create({ userEmail, name: newFolderName, assignedDrips: [] });

    const fromFolderId = lead.folderId ? String(lead.folderId) : null;
    const prevStatus = (lead as any).status || (lead as any).Status || "";

    // Move & normalize fields
    lead.folderId = folder._id;
    (lead as any).Folder = folder._id;                 // legacy compatibility
    (lead as any)["Folder Name"] = newFolderName;      // legacy compatibility
    (lead as any).updatedAt = new Date();

    // Sync status for system folders (including "Resolved")
    if (SYSTEM.has(newFolderName)) {
      (lead as any).status = newFolderName;
      (lead as any).Status = newFolderName;            // legacy compatibility

      // When truly resolved-ish, stamp resolvedAt
      if (["Resolved", "Not Interested", "Sold"].includes(newFolderName)) {
        (lead as any).resolvedAt = new Date();
        (lead as any).isAIEngaged = false;
        (lead as any).assignedDrips = [];
        (lead as any).dripProgress = [];
      }
    }

    // Visible history entry
    lead.interactionHistory = lead.interactionHistory || [];
    lead.interactionHistory.push({
      type: "status",
      from: prevStatus || fromFolderId || "(none)",
      to: newFolderName,
      date: new Date(),
    });

    await lead.save();

    // 🔔 Realtime UI update
    let io = (res as any)?.socket?.server?.io;
    try {
      if (!io) io = initSocket(res as any);
      io.to(userEmail).emit("lead:updated", {
        _id: String(lead._id),
        folderId: String(folder._id),
        status: (lead as any).status,
        resolvedAt: (lead as any).resolvedAt || null,
        updatedAt: (lead as any).updatedAt,
      });
    } catch (e) {
      console.warn("disposition-lead: socket emit failed (non-fatal):", (e as any)?.message || e);
    }

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      fromFolderId,
      toFolderId: String(folder._id),
      status: (lead as any).status,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
