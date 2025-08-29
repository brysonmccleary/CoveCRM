// pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { initSocket } from "@/lib/socket";

const SYSTEM = new Set(["Not Interested", "Booked Appointment", "Sold", "Resolved"]);

// Safe regex escape for exact, case-insensitive name matching
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type ExistingLeadLean = { _id: any; folderId?: any; status?: string } | null;
type FolderLean = { _id: any; name: string } | null;

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

    // Ensure the lead exists and belongs to this user
    const existing: ExistingLeadLean = await Lead.findOne({ _id: leadId, userEmail })
      .select({ _id: 1, folderId: 1, status: 1 })
      .lean<ExistingLeadLean>()
      .exec();
    if (!existing) return res.status(404).json({ message: "Lead not found." });

    const fromFolderId = existing.folderId ? String(existing.folderId) : null;

    // ── Updated: resolve by exact name first, then case-insensitive exact; never cross-match ──
    const nameExact = rawName;
    const nameRegex = new RegExp(`^${escapeRegex(rawName)}$`, "i");

    // 1) Exact (case-sensitive) match
    let target: FolderLean = await Folder.findOne({ userEmail, name: nameExact })
      .select({ _id: 1, name: 1 })
      .lean<FolderLean>()
      .exec();

    // 2) If not found, case-insensitive exact; prefer oldest if duplicates
    if (!target) {
      target = await Folder.findOne({ userEmail, name: nameRegex })
        .select({ _id: 1, name: 1, createdAt: 1 })
        .sort({ createdAt: 1, _id: 1 })
        .lean<any>()
        .exec();
    }

    // 3) If still not found, create the correct folder
    if (!target) {
      const created = await Folder.create({ userEmail, name: nameExact, assignedDrips: [] });
      target = { _id: created._id, name: nameExact };
    }

    // 4) Safety: if the resolved doc's name doesn't equal the requested name (ignoring case), create correct one
    if (String(target.name).toLowerCase() !== nameExact.toLowerCase()) {
      const created = await Folder.create({ userEmail, name: nameExact, assignedDrips: [] });
      target = { _id: created._id, name: nameExact };
    }
    // ── end updated block ──

    // 🔒 Atomic single-document update — move only THIS lead
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

    // Socket notify so lists/pages refetch
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
      status: SYSTEM.has(rawName) ? rawName : existing.status,
      folderName: rawName,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
