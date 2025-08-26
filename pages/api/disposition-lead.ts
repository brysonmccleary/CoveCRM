// /pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  const sessionEmail = session?.user?.email?.toLowerCase();
  if (!sessionEmail) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { leadId, newFolderName } = (req.body || {}) as {
    leadId?: string;
    newFolderName?: string;
  };

  if (!leadId || !newFolderName?.trim()) {
    res.status(400).json({ message: "Missing required fields." });
    return;
  }

  try {
    await dbConnect();

    // 1) Load the lead by _id (regardless of userEmail), then authorize.
    const lead = await Lead.findOne({ _id: leadId });
    if (!lead) {
      res.status(404).json({ message: "Lead not found." });
      return;
    }

    const userLc  = String(lead.userEmail || "").toLowerCase();
    const ownerLc = String((lead as any).ownerEmail || "").toLowerCase();
    const otherLc = String((lead as any).user || "").toLowerCase();

    const allowed =
      userLc === sessionEmail ||
      ownerLc === sessionEmail ||
      otherLc === sessionEmail ||
      !userLc; // allow normalization if userEmail was missing

    if (!allowed) {
      res.status(403).json({ message: "Forbidden: lead not owned by user." });
      return;
    }

    // 2) Ensure destination folder exists for THIS user (case-sensitive name).
    const destName = newFolderName.trim();
    let folder = await Folder.findOne({ userEmail: sessionEmail, name: destName });
    if (!folder) {
      folder = await Folder.create({ userEmail: sessionEmail, name: destName, assignedDrips: [] });
    }

    // 3) Normalize ownership + move
    lead.userEmail = sessionEmail;      // <- normalize to strict scope
    (lead as any).ownerEmail = sessionEmail; // keep legacy owner in sync
    lead.folderId = folder._id;
    lead.status = destName;
    await lead.save();

    // 4) Optional history entry for audit trail
    await Lead.updateOne(
      { _id: lead._id },
      {
        $push: {
          interactionHistory: {
            type: "status",
            from: userLc || ownerLc || otherLc || null,
            to: destName,
            date: new Date(),
          },
        },
      }
    );

    res.status(200).json({
      success: true,
      message: "Lead moved successfully.",
      folderId: String(folder._id),
    });
  } catch (error) {
    console.error("Disposition error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}
