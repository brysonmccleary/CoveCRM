// pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { initSocket } from "@/lib/socket";

const SYSTEM = new Set(["Not Interested", "Booked Appointment", "Sold", "Resolved"]);

// Safe regex escape
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type ExistingLeadLean = { _id: any; folderId?: any; status?: string } | null;
type FolderLean = { _id: any; name: string };

/** Resolve by exact name, falling back to case-insensitive EXACT, else create. Never cross-match. */
async function getOrCreateFolder(userEmail: string, nameExact: string): Promise<FolderLean> {
  // 1) exact (case-sensitive)
  let f: any = await Folder.findOne({ userEmail, name: nameExact })
    .select({ _id: 1, name: 1 })
    .lean()
    .exec();

  // 2) exact (case-insensitive)
  if (!f) {
    const nameRegex = new RegExp(`^${escapeRegex(nameExact)}$`, "i");
    f = await Folder.findOne({ userEmail, name: nameRegex })
      .select({ _id: 1, name: 1, createdAt: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();
  }

  // 3) create if none
  if (!f) {
    const created = await Folder.create({ userEmail, name: nameExact, assignedDrips: [] });
    return { _id: created._id, name: nameExact };
  }

  // Safety: mismatch? create correct one.
  if (String(f.name).toLowerCase() !== nameExact.toLowerCase()) {
    const created = await Folder.create({ userEmail, name: nameExact, assignedDrips: [] });
    return { _id: created._id, name: nameExact };
  }

  return f as FolderLean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, newFolderName } = (req.body ?? {}) as { leadId?: string; newFolderName?: string };
  const rawName = (newFolderName || "").trim();
  if (!leadId || !rawName) return res.status(400).json({ message: "Missing required fields." });

  try {
    await dbConnect();

    // Verify lead belongs to user
    const existing: ExistingLeadLean = await Lead.findOne({ _id: leadId, userEmail })
      .select({ _id: 1, folderId: 1, status: 1 })
      .lean<ExistingLeadLean>()
      .exec();
    if (!existing) return res.status(404).json({ message: "Lead not found." });

    const fromFolderId = existing.folderId ? String(existing.folderId) : null;

    // ✅ Deterministic resolution
    const target = await getOrCreateFolder(userEmail, rawName);

    // Move ONLY this lead
    const setFields: Record<string, any> = {
      folderId: target._id,
      folderName: rawName,
      ["Folder Name"]: rawName,
      folder: rawName,
      updatedAt: new Date(),
    };
    if (SYSTEM.has(rawName)) setFields.status = rawName;

    const write = await Lead.updateOne({ _id: leadId, userEmail }, { $set: setFields }).exec();
    if (write.matchedCount === 0) {
      return res.status(404).json({ message: "Lead not found after update." });
    }

    // Notify clients
    try {
      let io = (res as any)?.socket?.server?.io;
      if (!io) io = initSocket(res as any);
      io?.to(userEmail).emit("lead:updated", {
        _id: String(leadId),
        folderId: String(target._id),
        folderName: rawName,
        status: SYSTEM.has(rawName) ? rawName : existing.status,
        updatedAt: new Date(),
      });
    } catch (e) {
      console.warn("disposition-lead: socket emit failed (non-fatal):", e);
    }

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      fromFolderId,
      toFolderId: String(target._id),
      folderName: rawName,
      resolvedFolderName: target.name, // returned so you can verify quickly in Network tab
      status: SYSTEM.has(rawName) ? rawName : existing.status,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
