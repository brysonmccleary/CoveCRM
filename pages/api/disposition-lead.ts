// /pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next"; // <-- use the /next import
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  // Cast session to any to avoid TS complaining that user doesn't exist on {}
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const userEmail: string =
    typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  // Accept either {leadId, newFolderName} or legacy {id, disposition}
  const body = (req.body || {}) as any;
  const leadId = String(body.leadId || body.id || "").trim();
  const newFolderName = String(body.newFolderName || body.disposition || "").trim();
  if (!leadId || !newFolderName) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  try {
    await dbConnect();

    // Accept leads owned via userEmail or (legacy) ownerEmail
    const lead = await Lead.findOne({
      _id: leadId,
      $or: [{ userEmail }, { ownerEmail: userEmail }],
    });
    if (!lead) return res.status(404).json({ message: "Lead not found." });

    // Ensure target folder exists for this user
    let folder = await Folder.findOne({ userEmail, name: newFolderName });
    if (!folder) {
      folder = await Folder.create({ userEmail, name: newFolderName, assignedDrips: [] });
    }

    const fromFolderId = lead.folderId ? String(lead.folderId) : null;

    // Move + sync status with folder name
    lead.folderId = folder._id;
    (lead as any).status = newFolderName;
    await lead.save();

    // Best-effort history entry
    try {
      await Lead.updateOne(
        { _id: lead._id },
        {
          $push: {
            interactionHistory: {
              type: "status",
              from: fromFolderId,
              to: newFolderName,
              date: new Date(),
            },
          },
        },
      );
    } catch {}

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      fromFolderId,
      toFolderId: String(folder._id),
      status: newFolderName,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
