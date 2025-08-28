// pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { initSocket } from "@/lib/socket";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  // Be permissive with types so Next build doesn't choke
  const session = (await getServerSession(req as any, res as any, authOptions as any)) as any;
  const userEmail: string = (session?.user?.email || "").toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const body = (req.body ?? {}) as { leadId?: string; id?: string; newFolderName?: string; disposition?: string };
  const leadId = body.leadId || body.id;
  const newFolderName = (body.newFolderName || body.disposition || "").trim();

  if (!leadId || !newFolderName) {
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
    lead.status = newFolderName;
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

    // 🔔 Broadcast to user room so folder views & lists refetch
    try {
      const io = initSocket(res as any);
      // We use the userEmail as the room (your client already joins this)
      io?.to(userEmail).emit("lead:disposition", {
        leadId: String(lead._id),
        fromFolderId,
        toFolderId: String(folder._id),
        status: lead.status,
        userEmail,
        ts: Date.now(),
      });
    } catch (e) {
      // Non-fatal; just log if socket isn’t available
      console.warn("disposition-lead: socket emit failed (non-fatal):", (e as any)?.message || e);
    }

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      fromFolderId,
      toFolderId: String(folder._id),
      status: lead.status,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
