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

    // Ensure this lead belongs to the user
    const lead: any = await Lead.findOne({ _id: leadId, userEmail });
    if (!lead) return res.status(404).json({ message: "Lead not found." });

    const fromFolderId = lead.folderId ? String(lead.folderId) : null;

    // Resolve CANONICAL folder id for this exact name (case-insensitive, per-user)
    const nameRegex = new RegExp(`^${escapeRegex(rawName)}$`, "i");
    const sameNameFolders = await Folder.find({ userEmail, name: nameRegex })
      .select({ _id: 1, name: 1, createdAt: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();

    let canonicalId: any;
    if (sameNameFolders.length > 0) {
      canonicalId = sameNameFolders[0]._id;

      // If duplicates with SAME NAME exist, repoint leads on the extras to the canonical id
      if (sameNameFolders.length > 1) {
        const otherIds = sameNameFolders.slice(1).map((f) => f._id);
        if (otherIds.length) {
          await Lead.updateMany(
            { userEmail, folderId: { $in: otherIds } },
            {
              $set: {
                folderId: canonicalId,
                folderName: rawName,
                ["Folder Name"]: rawName,
                ...(SYSTEM.has(rawName) ? { status: rawName } : {}),
                updatedAt: new Date(),
              },
            }
          );
        }
      }
    } else {
      const created = await Folder.create({ userEmail, name: rawName, assignedDrips: [] });
      canonicalId = created._id;
    }

    // Move THIS lead + sync legacy/friendly fields
    lead.folderId = canonicalId;
    (lead as any).folder = rawName;            // legacy
    (lead as any)["Folder Name"] = rawName;    // legacy
    (lead as any).folderName = rawName;        // friendly alias
    if (SYSTEM.has(rawName)) lead.status = rawName;
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
            to: rawName,
            date: new Date(),
          },
        },
      }
    );

    // Emit socket so other views refresh
    try {
      let io = (res as any)?.socket?.server?.io;
      if (!io) io = initSocket(res as any);
      if (io) {
        io.to(userEmail).emit("lead:updated", {
          _id: String(lead._id),
          folderId: String(canonicalId),
          folder: rawName,
          folderName: rawName,
          ["Folder Name"]: rawName,
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
      toFolderId: String(canonicalId),
      status: lead.status,
      folderName: rawName,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
