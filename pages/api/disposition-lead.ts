// /pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import mongoose from "mongoose";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { initSocket } from "@/lib/socket";
import { SYSTEM_FOLDERS, canonicalizeName } from "@/lib/systemFolders";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeName(s?: string) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

// Map canonical -> official system folder name
const CANON_TO_OFFICIAL = new Map(
  SYSTEM_FOLDERS.map((n) => [canonicalizeName(n), n] as const)
);

function resolveTargetName(name: string): { finalName: string; isSystem: boolean } {
  const canon = canonicalizeName(name);
  const official = CANON_TO_OFFICIAL.get(canon);
  return official
    ? { finalName: official, isSystem: true }
    : { finalName: normalizeName(name), isSystem: false };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  // Debug tag so we can prove which code is live
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Disposition-Impl", "sys-v3");

  try {
    const session = await getServerSession(req, res, authOptions);
    const userEmail = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

    const { leadId, newFolderName } = (req.body ?? {}) as { leadId?: string; newFolderName?: string };
    const rawName = normalizeName(newFolderName || "");
    if (!leadId || !rawName) return res.status(400).json({ message: "Missing required fields." });

    let leadObjectId: mongoose.Types.ObjectId;
    try {
      leadObjectId = new mongoose.Types.ObjectId(leadId);
    } catch {
      return res.status(400).json({ message: "Invalid leadId." });
    }

    await dbConnect();

    // Verify lead belongs to user
    const existing = await Lead.findOne({ _id: leadObjectId, userEmail })
      .select({ _id: 1, status: 1 })
      .lean<{ _id: any; status?: string } | null>();
    if (!existing) return res.status(404).json({ message: "Lead not found." });

    const { finalName, isSystem } = resolveTargetName(rawName);

    // Resolve/create target folder
    const nameFilter = { $regex: `^\\s*${escapeRegex(finalName)}\\s*$`, $options: "i" as const };
    let targetFolderId: mongoose.Types.ObjectId | null = null;

    if (isSystem) {
      // Bypass Mongoose validators for system folders: use raw collection upsert
      await Folder.collection.updateOne(
        { userEmail, name: nameFilter } as any,
        { $setOnInsert: { userEmail, name: finalName, assignedDrips: [] } },
        { upsert: true }
      );
      const f = await Folder.findOne({ userEmail, name: nameFilter })
        .select({ _id: 1 })
        .lean<{ _id: any } | null>();
      if (!f) return res.status(500).json({ message: "Failed to resolve system folder." });
      targetFolderId = f._id as any;
    } else {
      // Non-system: normal guarded upsert is OK
      const f = await Folder.findOneAndUpdate(
        { userEmail, name: new RegExp(`^${escapeRegex(finalName)}$`, "i") },
        { $setOnInsert: { userEmail, name: finalName, assignedDrips: [] as string[] } },
        { new: true, upsert: true }
      )
        .select({ _id: 1 })
        .lean<{ _id: any } | null>();
      if (!f) return res.status(500).json({ message: "Failed to resolve folder." });
      targetFolderId = f._id as any;
    }

    // Move the lead; set status only if target is a system folder
    const setFields: Record<string, any> = {
      folderId: targetFolderId,
      folderName: finalName,
      ["Folder Name"]: finalName,
      folder: finalName,
      updatedAt: new Date(),
    };
    if (isSystem) setFields.status = finalName;

    const write = await Lead.updateOne(
      { _id: leadObjectId, userEmail },
      { $set: setFields }
    );
    if (write.matchedCount === 0) return res.status(404).json({ message: "Lead not found on update." });

    // Best-effort socket emit
    try {
      let io = (res as any)?.socket?.server?.io;
      if (!io) io = initSocket(res as any);
      io?.to(userEmail).emit("lead:updated", {
        _id: String(leadObjectId),
        folderId: String(targetFolderId),
        folderName: finalName,
        status: isSystem ? finalName : existing?.status,
        updatedAt: new Date(),
      });
    } catch {}

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      toFolderId: String(targetFolderId),
      folderName: finalName,
      isSystem,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
