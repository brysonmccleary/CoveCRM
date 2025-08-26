// /pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const sessionEmail =
    typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : null;

  const { leadId, newFolderName } = (req.body || {}) as {
    leadId?: string;
    newFolderName?: string;
  };

  if (!leadId || !newFolderName || !newFolderName.trim()) {
    return res.status(400).json({ message: "Missing required fields." });
  }
  const destName = newFolderName.trim();

  try {
    await dbConnect();

    // Load lead by _id first (don’t filter by userEmail yet to allow normalization)
    const lead = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found." });

    // Determine effective email for this action
    const userLc  = String(lead.userEmail || "").toLowerCase();
    const ownerLc = String((lead as any).ownerEmail || "").toLowerCase();
    const otherLc = String((lead as any).user || "").toLowerCase();

    // Prefer session email; else fall back to whichever email is on the lead
    const effectiveEmail = sessionEmail || userLc || ownerLc || otherLc;
    if (!effectiveEmail) {
      return res.status(403).json({ message: "Forbidden: no owner to attribute." });
    }

    // Ensure destination folder exists for the effective owner
    let folder = await Folder.findOne({ userEmail: effectiveEmail, name: destName });
    if (!folder) {
      folder = await Folder.create({ userEmail: effectiveEmail, name: destName, assignedDrips: [] });
    }

    // Normalize lead ownership and move
    (lead as any).userEmail  = effectiveEmail;
    (lead as any).ownerEmail = effectiveEmail;
    (lead as any).folderId   = folder._id;
    (lead as any).status     = destName;
    await lead.save();

    // Append a simple history line
    await Lead.updateOne(
      { _id: lead._id },
      {
        $push: {
          interactionHistory: {
            type: "status",
            to: destName,
            date: new Date(),
          },
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Lead moved successfully.",
      folderId: String(folder._id),
    });
  } catch (error) {
    console.error("Disposition error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
