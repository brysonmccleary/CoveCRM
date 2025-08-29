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

    if (!folderId || typeof folderId !== "string" || !folderId.trim()) {
      return res.status(200).json({ leads: [] as LeadType[], folderName: null });
    }

    const rawId = folderId.trim();

    // Resolve folder (allow _id or name)
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

    const canonicalId = folderDoc._id;
    const canonicalIdStr = String(canonicalId);
    const folderName = folderDoc.name || rawId;
    const folderNameLc = (folderName || "").toLowerCase();

    let leads: any[] = [];

    // Special-case: UNSORTED shows *all* leads with no folderId (regardless of legacy name fields)
    if (folderNameLc === "unsorted") {
      leads = await Lead.find(
        {
          userEmail: email,
          $or: [{ folderId: { $exists: false } }, { folderId: null }],
        },
        {
          _id: 1,
          name: 1,
          firstName: 1,
          lastName: 1,
          "First Name": 1,
          "Last Name": 1,
          Phone: 1,
          phone: 1,
          Email: 1,
          email: 1,
          status: 1,
          updatedAt: 1,
          folderId: 1,
        }
      )
        .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
        .lean()
        .exec();
    } else {
      // STRICT by folderId + *narrow* legacy fallback by name (only when folderId is missing)
      leads = await Lead.find(
        {
          userEmail: email,
          $or: [
            // Strict
            { folderId: canonicalId },
            { folderId: canonicalIdStr },
            { $expr: { $eq: [{ $toString: "$folderId" }, canonicalIdStr] } },

            // Legacy fallback ONLY if folderId missing/null and name matches this folder
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
        },
        {
          _id: 1,
          name: 1,
          firstName: 1,
          lastName: 1,
          "First Name": 1,
          "Last Name": 1,
          Phone: 1,
          phone: 1,
          Email: 1,
          email: 1,
          status: 1,
          State: 1,
          state: 1,
          Age: 1,
          age: 1,
          updatedAt: 1,
          folderId: 1,
        }
      )
        .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
        .lean()
        .exec();
    }

    return res.status(200).json({
      leads: (leads || []).map((l: any) => ({
        ...l,
        _id: String(l._id),
        folderId: l?.folderId ? String(l.folderId) : null,
      })) as LeadType[],
      folderName,
      resolvedFolderId: canonicalIdStr,
    });
  } catch (error) {
    console.error("❌ get-leads-by-folder error:", error);
    return res.status(500).json({ message: "Error fetching leads" });
  }
}
