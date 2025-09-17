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

// Map canonical -> official
const CANON_TO_OFFICIAL = new Map(
  SYSTEM_FOLDERS.map((n) => [canonicalizeName(n), n] as const)
);

function coerceToOfficialIfSystemLike(name: string): { finalName: string; isSystem: boolean } {
  const canon = canonicalizeName(name);
  const official = CANON_TO_OFFICIAL.get(canon);
  if (official) return { finalName: official, isSystem: true };
  return { finalName: normalizeName(name), isSystem: false };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Disposition-Impl", "sys-v2");

  try {
    const session = await getServerSession(req, res, authOptions);
    const userEmail = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

    const { leadId, newFolderName } = (req.body ?? {}) as { leadId?: string; newFolderName?: string };
    const rawName = normalizeName(newFolderName || "");
    if (!leadId || !rawName) return res.status(400).json({ message: "Missing required fields." });

    // Validate ObjectId early
    let leadObjectId: mongoose.Types.ObjectId;
    try {
      leadObjectId = new mongoose.Types.ObjectId(leadId);
    } catch {
      return res.status(400).json({ message: "Invalid leadId." });
    }

    await dbConnect();

    // Make sure the lead belongs to this user
    const existing = await Lead.findOne({ _id: leadObjectId, userEmail })
      .select({ _id: 1, status: 1 })
      .lean<{ _id: any; status?: string } | null>();
    if (!existing) return res.status(404).json({ message: "Lead not found." });

    const { finalName, isSystem } = coerceToOfficialIfSystemLike(rawName);

    // Resolve / create target folder
    let targetFolderId: mongoose.Types.ObjectId | null = null;

    if (isSystem) {
      // Bypass Mongoose validators/hooks: raw collection upsert scoped by userEmail + case-insensitive name
      const filter = {
        userEmail,
        name: { $regex: `^\\s*${escapeRegex(finalName)}\\s*$`, $options: "i" },
      };
      const up = await Folder.collection.updateOne(
        filter as any,
        { $setOnInsert: { userEmail, name: finalName, assignedDrips: [] } },
        { upsert: true }
      );

      if ((up as any).upsertedId?. _id) {
        targetFolderId = (up as any).upsertedId._id as mongoose.Types.ObjectId;
      } else {
        const f = await Folder.findOne(filter).select({ _id: 1 }).lean<{ _id: any } | null>();
        if (!f) return res.status(500).json({ message: "Failed to resolve system folder." });
        targetFolderId = f._id as any;
      }
    } else {
      // Non-system names: normal Mongoose upsert (validators allowed)
      const nameRegex = new RegExp(`^${escapeRegex(finalName)}$`, "i");
      const f = await Folder.findOneAndUpdate(
        { userEmail, name: nameRegex },
        { $setOnInsert: { userEmail, name: finalName, assignedDrips: [] as string[] } },
        { new: true, upsert: true }
      ).select({ _id: 1, name: 1 });
      if (!f) return res.status(500).json({ message: "Failed to resolve folder." });
      targetFolderId = f._id as any;
    }

    // Move the lead (and set status only if moving into system folder)
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

    // Best-effort socket notify
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
    } catch { /* non-fatal */ }

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
