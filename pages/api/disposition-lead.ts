// /pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import mongoose from "mongoose";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { initSocket } from "@/lib/socket";

const SYSTEM = new Set(["not interested", "booked appointment", "sold", "resolved"]);

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, newFolderName } = (req.body ?? {}) as { leadId?: string; newFolderName?: string };
  const rawName = String(newFolderName || "").trim();
  if (!leadId || !rawName) return res.status(400).json({ message: "Missing required fields." });

  await dbConnect();

  const mongoSession = await mongoose.startSession();
  try {
    let targetFolderId: mongoose.Types.ObjectId | null = null;
    let previousStatus: string | undefined;

    await mongoSession.withTransaction(async () => {
      // Verify lead belongs to user
      const existing = await Lead.findOne({ _id: leadId, userEmail })
        .select({ _id: 1, folderId: 1, status: 1 })
        .session(mongoSession)
        .lean<{ _id: any; folderId?: any; status?: string } | null>();
      if (!existing) throw new Error("Lead not found.");

      previousStatus = existing.status;

      // Resolve destination folder (case-insensitive exact) or create
      const nameRegex = new RegExp(`^${escapeRegex(rawName)}$`, "i");
      const target = await Folder.findOneAndUpdate(
        { userEmail, name: nameRegex },
        { $setOnInsert: { userEmail, name: rawName, assignedDrips: [] as string[] } },
        { new: true, upsert: true, session: mongoSession }
      ).select({ _id: 1, name: 1 });

      targetFolderId = target!._id as any;

      // Move ONLY this lead (+ set status for system folders)
      const setFields: Record<string, any> = {
        folderId: targetFolderId,
        folderName: rawName,
        ["Folder Name"]: rawName,
        folder: rawName,
        updatedAt: new Date(),
      };
      if (SYSTEM.has(rawName.toLowerCase())) setFields.status = rawName;

      const write = await Lead.updateOne(
        { _id: leadId, userEmail },
        { $set: setFields },
        { session: mongoSession }
      );
      if (write.matchedCount === 0) throw new Error("Lead not found after update.");
    });

    // Socket notify (best-effort, out of transaction)
    try {
      let io = (res as any)?.socket?.server?.io;
      if (!io) io = initSocket(res as any);
      io?.to(userEmail).emit("lead:updated", {
        _id: String(leadId),
        folderId: String(targetFolderId),
        folderName: rawName,
        status: SYSTEM.has(rawName.toLowerCase()) ? rawName : previousStatus,
        updatedAt: new Date(),
      });
    } catch (e) {
      console.warn("disposition-lead: socket emit failed (non-fatal):", e);
    }

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      toFolderId: String(targetFolderId),
      folderName: rawName,
      status: SYSTEM.has(rawName.toLowerCase()) ? rawName : previousStatus,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    mongoSession.endSession();
  }
}
