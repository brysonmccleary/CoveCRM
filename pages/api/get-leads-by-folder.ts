// pages/api/get-leads-by-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { Types } from "mongoose";

type FolderLean = { _id: Types.ObjectId | string; name?: string; userEmail?: string } | null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { folderId } = req.query as { folderId?: string };
  if (!folderId) {
    return res.status(400).json({ message: "folderId is required" });
  }

  try {
    await dbConnect();

    const session = await getServerSession(req, res, authOptions);
    const userEmail =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!userEmail) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Resolve a concrete ObjectId for the folder (accept id or name)
    let targetFolderId: Types.ObjectId;

    if (Types.ObjectId.isValid(folderId)) {
      targetFolderId = new Types.ObjectId(folderId);
    } else {
      const folderDoc = (await Folder.findOne({ userEmail, name: folderId })
        .select("_id")
        .lean()) as FolderLean;

      if (!folderDoc?._id) {
        return res.status(404).json({ message: `Folder '${folderId}' not found` });
      }
      targetFolderId = new Types.ObjectId(String(folderDoc._id));
    }

    // STRICT filter: only leads whose folderId matches (no legacy name fallback)
    const leads = await Lead.find({
      userEmail,
      $or: [{ folderId: targetFolderId }, { folderId: String(targetFolderId) }],
    })
      .sort({ updatedAt: -1 })
      .limit(1000)
      .lean();

    const cleaned = (leads as any[]).map((l) => ({
      ...l,
      _id: String(l._id),
      folderId: l.folderId ? String(l.folderId) : null,
    }));

    return res.status(200).json({
      leads: cleaned,
      folderName: folderId,
    });
  } catch (error) {
    console.error("❌ get-leads-by-folder error:", error);
    return res.status(500).json({ message: "Error fetching leads" });
  }
}
