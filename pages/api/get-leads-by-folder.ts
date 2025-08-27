// pages/api/get-leads-by-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { Types } from "mongoose";

type LeadType = Record<string, any>;
type LeanFolderDoc = { _id: Types.ObjectId; name?: string };

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

    const rawId = String(folderId).trim();

    // Resolve folder (accept ObjectId or legacy Name) — force lean() type to avoid TS union w/ array
    let folderDoc: LeanFolderDoc | null = null;

    if (Types.ObjectId.isValid(rawId)) {
      folderDoc = (await Folder.findOne({ _id: new Types.ObjectId(rawId), userEmail: email })
        .select({ _id: 1, name: 1 })
        .lean()
        .exec()) as LeanFolderDoc | null;
    } else {
      folderDoc = (await Folder.findOne({ userEmail: email, name: rawId })
        .select({ _id: 1, name: 1 })
        .lean()
        .exec()) as LeanFolderDoc | null;
    }

    if (!folderDoc) {
      return res.status(200).json({ leads: [] as LeadType[], folderName: null });
    }

    const resolvedId = folderDoc._id;
    const resolvedIdStr = String(resolvedId);
    const folderName = folderDoc.name || rawId;
    const folderNameLc = folderName.toLowerCase();

    // STRICT for normalized docs + FALLBACK for legacy name-only docs (no folderId)
    const leads = await Lead.find({
      userEmail: email,
      $or: [
        { folderId: resolvedId }, // ObjectId match
        { folderId: resolvedIdStr }, // stored as string
        { $expr: { $eq: [{ $toString: "$folderId" }, resolvedIdStr] } }, // mixed

        // Fallback by legacy names only when folderId missing/null
        {
          $and: [
            { $or: [{ folderId: { $exists: false } }, { folderId: null }] },
            {
              $or: [
                { $expr: { $eq: [{ $toLower: "$folderName" }, folderNameLc] } },
                { $expr: { $eq: [{ $toLower: "$Folder" }, folderNameLc] } },
                { $expr: { $eq: [{ $toLower: { $ifNull: ["$Folder Name", ""] } }, folderNameLc] } },
              ],
            },
          ],
        },
      ],
    })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    return res.status(200).json({
      leads: (leads || []).map((l) => ({
        ...l,
        _id: String(l._id),
        folderId: l.folderId ? String(l.folderId) : null,
      })) as LeadType[],
      folderName,
      resolvedFolderId: resolvedIdStr,
    });
  } catch (error) {
    console.error("❌ get-leads-by-folder error:", error);
    return res.status(500).json({ message: "Error fetching leads" });
  }
}
