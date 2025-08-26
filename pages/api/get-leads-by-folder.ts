import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { Types } from "mongoose";

type LeadType = Record<string, any>;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  try {
    const session = await getServerSession(req, res, authOptions);
    const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    const { folderId } = req.query as { folderId?: string };
    await dbConnect();

    // No folder selected → intentionally empty (prevents "show all")
    if (!folderId || typeof folderId !== "string" || !folderId.trim()) {
      return res.status(200).json({ leads: [] as LeadType[], folderName: null });
    }

    // Resolve folder (accept hex ObjectId string or legacy folder name)
    let resolvedId: Types.ObjectId | null = null;

    if (Types.ObjectId.isValid(folderId)) {
      resolvedId = new Types.ObjectId(folderId);
    } else {
      const byName = await Folder.findOne({ userEmail: email, name: folderId })
        .select({ _id: 1, name: 1 })
        .lean<{ _id: Types.ObjectId; name: string } | null>();
      if (!byName) {
        return res.status(200).json({ leads: [] as LeadType[], folderName: null });
      }
      resolvedId = new Types.ObjectId(String(byName._id));
    }

    const resolvedIdStr = String(resolvedId);

    // STRICT + ROBUST: only this user's leads, and only this folder, regardless of stored type
    const leads = await Lead.find({
      userEmail: email,
      $or: [
        { folderId: resolvedId },                                     // ObjectId
        { folderId: resolvedIdStr },                                   // string "ObjectId"
        { $expr: { $eq: [{ $toString: "$folderId" }, resolvedIdStr] } } // mixed
      ],
    })
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(200).json({
      leads: (leads || []).map((l) => ({
        ...l,
        _id: String(l._id),
        folderId: l.folderId ? String(l.folderId) : null,
      })) as LeadType[],
      folderName: folderId,
      resolvedFolderId: resolvedIdStr,
    });
  } catch (error) {
    console.error("❌ get-leads-by-folder error:", error);
    return res.status(500).json({ message: "Error fetching leads" });
  }
}
