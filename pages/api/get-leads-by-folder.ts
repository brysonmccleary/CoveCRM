// pages/api/get-leads-by-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { Types } from "mongoose";

interface LeadType {
  _id: string;
  folderId?: string | null;
  [key: string]: any;
}

const userMatch = (email: string) => ({
  $or: [{ userEmail: email }, { ownerEmail: email }, { user: email }],
});

function escapeRegex(s: string) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const { folderId } = req.query;
  if (!folderId || typeof folderId !== "string") {
    return res.status(400).json({ message: "folderId is required and must be a string" });
  }

  try {
    await dbConnect();

    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    // 1) Resolve folder by ObjectId or by name (prefer user-owned over global)
    let folderDoc: any = null;

    if (Types.ObjectId.isValid(folderId)) {
      folderDoc =
        (await Folder.findOne({ _id: folderId, userEmail: email }).lean().exec()) ||
        (await Folder.findOne({ _id: folderId, userEmail: { $exists: false } }).lean().exec());
    } else {
      const name = String(folderId);
      folderDoc =
        (await Folder.findOne({ name, userEmail: email }).lean().exec()) ||
        (await Folder.findOne({ name, userEmail: { $exists: false } }).lean().exec());
    }

    if (!folderDoc) return res.status(404).json({ message: "Folder not found" });

    const folderName = String(folderDoc.name || "");
    const nameRegex = new RegExp(`^${escapeRegex(folderName)}$`, "i");

    // 2) Canonical set: leads with this exact folderId
    const leadsWithId = await Lead.find({
      ...userMatch(email),
      folderId: folderDoc._id,
    })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    // 3) Fallback set: ONLY leads with NO folderId but legacy name that matches
    const leadsByLegacyName = await Lead.find({
      ...userMatch(email),
      $and: [
        { $or: [{ folderId: { $exists: false } }, { folderId: null }] },
        { $or: [{ folderName: nameRegex }, { Folder: nameRegex }, { ["Folder Name"]: nameRegex }] },
      ],
    })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    // 4) De-dupe by _id (favor canonical set)
    const seen = new Set<string>();
    const merged: LeadType[] = [];

    for (const l of leadsWithId) {
      const id = String(l._id);
      if (!seen.has(id)) {
        seen.add(id);
        merged.push({ ...l, _id: id, folderId: l.folderId ? String(l.folderId) : null });
      }
    }
    for (const l of leadsByLegacyName) {
      const id = String(l._id);
      if (!seen.has(id)) {
        seen.add(id);
        merged.push({ ...l, _id: id, folderId: l.folderId ? String(l.folderId) : null });
      }
    }

    return res.status(200).json({
      leads: merged,
      folderName,
    });
  } catch (error) {
    console.error("❌ Fetch leads error:", error);
    return res.status(500).json({ message: "Error fetching leads" });
  }
}
