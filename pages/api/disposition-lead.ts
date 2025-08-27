// /pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  // Auth
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const userEmail: string = (session?.user?.email || "").toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  // Inputs
  const body = (req.body ?? {}) as {
    leadId?: string;
    id?: string;
    newFolderName?: string;
    disposition?: string;
  };
  const leadId = body.leadId || body.id || "";
  const labelRaw = body.newFolderName || body.disposition || "";
  const label = String(labelRaw).trim();
  if (!leadId || !label) return res.status(400).json({ message: "Missing required fields (leadId, newFolderName)" });

  try {
    await dbConnect();

    // Ensure this is your lead
    const lead = await Lead.findOne({ _id: leadId, userEmail });
    if (!lead) return res.status(404).json({ message: "Lead not found." });

    // Find or create target folder by case-insensitive name scoped to user
    const rx = new RegExp(`^${escapeRegExp(label)}$`, "i");
    let folder = await Folder.findOne({ userEmail, name: rx });
    if (!folder) folder = await Folder.create({ userEmail, name: label, assignedDrips: [] });

    const fromFolderId = lead.folderId ? String(lead.folderId) : null;

    // Move + sync fields
    await Lead.updateOne(
      { _id: lead._id, userEmail },
      {
        $set: {
          folderId: folder._id,
          status: label,       // keep status in lockstep with folder
          disposition: label,  // keep legacy field in sync too
        },
        $push: {
          interactionHistory: {
            type: "status",
            from: fromFolderId,
            to: label,
            date: new Date(),
          },
        },
      }
    );

    // Verify & return details
    const verify = await Lead.findById(lead._id)
      .select({ folderId: 1, status: 1, disposition: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      leadId: String(lead._id),
      fromFolderId,
      toFolderId: String(folder._id),
      toFolderName: folder.name,
      verify,
    });
  } catch (e: any) {
    console.error("disposition-lead error:", e?.message || e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
