// /pages/api/mobile/leads-by-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { Types } from "mongoose";

type LeadType = Record<string, any>;
type LeanFolderDoc = { _id: Types.ObjectId; name?: string };

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET || process.env.NEXTAUTH_SECRET || "dev-mobile-secret";

function getEmailFromAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const email = (payload?.email || payload?.sub || "").toString().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  try {
    const email = getEmailFromAuth(req);
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    const { folderId } = req.query as { folderId?: string };
    await dbConnect();

    if (!folderId || typeof folderId !== "string" || !folderId.trim()) {
      return res.status(200).json({ leads: [] as LeadType[], folderName: null });
    }

    const rawId = folderId.trim();

    // Resolve folder (allow _id or name), scoped to this user
    let folderDoc: LeanFolderDoc | null = null;
    if (Types.ObjectId.isValid(rawId)) {
      folderDoc = (await Folder.findOne({
        _id: new Types.ObjectId(rawId),
        userEmail: email,
      })
        .select({ _id: 1, name: 1 })
        .lean()) as LeanFolderDoc | null;
    } else {
      folderDoc = (await Folder.findOne({
        userEmail: email,
        name: rawId,
      })
        .select({ _id: 1, name: 1 })
        .lean()) as LeanFolderDoc | null;
    }

    if (!folderDoc) {
      return res.status(200).json({ leads: [] as LeadType[], folderName: null });
    }

    const canonicalId = folderDoc._id;
    const canonicalIdStr = String(canonicalId);
    const folderName = folderDoc.name || rawId;
    const folderNameLc = (folderName || "").toLowerCase();

    let leads: any[] = [];

    if (folderNameLc === "unsorted") {
      // Unsorted: only docs with no folderId
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
      // Strict: must match folderId
      leads = await Lead.find(
        {
          userEmail: email,
          $or: [
            { folderId: canonicalId },
            { folderId: canonicalIdStr },
            { $expr: { $eq: [{ $toString: "$folderId" }, canonicalIdStr] } },
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
    console.error("❌ mobile/leads-by-folder error:", error);
    return res.status(500).json({ message: "Error fetching leads" });
  }
}
