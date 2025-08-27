// pages/api/move-lead-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const userEmail =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";
  if (!userEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { leadId, newFolderName } = req.body as {
    leadId?: string;
    newFolderName?: string;
  };
  if (!leadId || !newFolderName?.trim()) {
    return res
      .status(400)
      .json({ message: "leadId and newFolderName are required" });
  }

  try {
    await dbConnect();

    // Ensure or create the destination folder for this user
    let folder = await Folder.findOne({ userEmail, name: newFolderName })
      .select({ _id: 1 })
      .lean<{ _id: any } | null>();
    if (!folder) {
      const created = await Folder.create({
        userEmail,
        name: newFolderName,
        assignedDrips: [],
      });
      folder = { _id: created._id };
    }

    // Move the lead (strictly scoped to this user)
    const updated = await Lead.findOneAndUpdate(
      { _id: leadId, userEmail },
      { $set: { folderId: folder._id, status: newFolderName } },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({
        message: "Lead not found or does not belong to this user",
      });
    }

    // Optional: add a simple history line (best-effort)
    try {
      await Lead.updateOne(
        { _id: updated._id, userEmail },
        {
          $push: {
            interactionHistory: {
              type: "status",
              from: updated.status,
              to: newFolderName,
              date: new Date(),
            },
          },
        },
      );
    } catch {
      // ignore history failures
    }

    return res.status(200).json({
      success: true,
      message: "Lead moved successfully",
      folderId: String(folder._id),
    });
  } catch (error) {
    console.error("Move lead error:", error);
    return res.status(500).json({ message: "Error moving lead" });
  }
}
