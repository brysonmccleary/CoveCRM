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

    // Make sure this is your lead and capture prior folder for history
    const existing = await Lead.findOne({ _id: leadId, userEmail }).select({ _id: 1, folderId: 1, status: 1 }).lean();
    if (!existing) return res.status(404).json({ message: "Lead not found." });
    const fromFolderId = existing.folderId ? String(existing.folderId) : null;

    // ——— Resolve CANONICAL folder for this exact name (case-insensitive) ———
    const nameRegex = new RegExp(`^${escapeRegex(rawName)}$`, "i");

    const sameNameFolders = await Folder.find({ userEmail, name: nameRegex })
      .select({ _id: 1, name: 1, createdAt: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();

    let canonical = sameNameFolders[0] || null;
    if (!canonical) {
      const created = await Folder.create({ userEmail, name: rawName, assignedDrips: [] });
      canonical = { _id: created._id, name: created.name, createdAt: created.get("createdAt") };
    }

    // Optional: if there are duplicates with the same name, repoint their leads to the canonical id
    if (sameNameFolders.length > 1) {
      const otherIds = sameNameFolders.slice(1).map((f) => f._id);
      if (otherIds.length) {
        await Lead.updateMany(
          { userEmail, folderId: { $in: otherIds } },
          {
            $set: {
              folderId: canonical._id,
              folderName: rawName,
              ["Folder Name"]: rawName,
              ...(SYSTEM.has(rawName) ? { status: rawName } : {}),
              updatedAt: new Date(),
            },
          }
        );
      }
    }

    // ——— ATOMIC UPDATE: move & write history in a single operation ———
    const now = new Date();
    const $set: Record<string, any> = {
      folderId: canonical._id,
      folderName: rawName,
      ["Folder Name"]: rawName, // legacy alias
      updatedAt: now,
    };
    if (SYSTEM.has(rawName)) $set.status = rawName;

    const updated = await Lead.findOneAndUpdate(
      { _id: leadId, userEmail },
      {
        $set,
        $push: {
          interactionHistory: {
            type: "status",
            from: fromFolderId,
            to: rawName,
            date: now,
          },
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(409).json({ message: "Lead changed concurrently; try again." });
    }

    // Emit socket event so other lists refresh
    try {
      let io = (res as any)?.socket?.server?.io;
      if (!io) io = initSocket(res as any);
      if (io) {
        io.to(userEmail).emit("lead:updated", {
          _id: String(updated._id),
          folderId: String(canonical._id),
          folder: rawName,
          folderName: rawName,
          ["Folder Name"]: rawName,
          status: updated.status,
          updatedAt: updated.updatedAt,
        });
      }
    } catch (e) {
      console.warn("disposition-lead: socket emit failed (non-fatal):", e);
    }

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      fromFolderId,
      toFolderId: String(canonical._id),
      status: updated.status,
      folderName: rawName,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
