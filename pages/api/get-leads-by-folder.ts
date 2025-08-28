// pages/api/get-leads-by-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import mongoose from "mongoose";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  try {
    const session = await getServerSession(req, res, authOptions);
    const userEmail = session?.user?.email?.toLowerCase() || "";
    if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

    const folderId = String(req.query.folderId || "").trim();
    if (!folderId || !mongoose.isValidObjectId(folderId)) {
      return res.status(400).json({ message: "Missing or invalid folderId" });
    }

    await mongooseConnect();

    // Make sure the folder belongs to this user
    const folder = await Folder.findOne({ _id: folderId, userEmail }, { _id: 1, name: 1 }).lean();
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // STRICT: only leads actually in this folderId
    const leads = await Lead.find(
      { userEmail, folderId: folder._id },
      { _id: 1, name: 1, Phone: 1, phone: 1, Email: 1, status: 1, updatedAt: 1 }
    )
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
      .limit(1000)
      .lean();

    return res.status(200).json({
      folder: { _id: String(folder._id), name: folder.name },
      leads: leads.map(l => ({
        ...l,
        _id: String(l._id),
        folderId: String(folder._id),
      })),
    });
  } catch (error) {
    console.error("get-leads-by-folder error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
