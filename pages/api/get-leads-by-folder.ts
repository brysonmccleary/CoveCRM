// pages/api/get-leads-by-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import mongoose, { Types } from "mongoose";

interface LeadType {
  _id: string;
  folderId?: string | null;
  [key: string]: any;
}

const norm = (s: string) => String(s || "").trim().toLowerCase();
const userMatch = (email: string) => ({
  $or: [{ userEmail: email }, { ownerEmail: email }, { user: email }],
});

function escapeRegex(s: string) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

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

    // 1) Resolve the folder document (by ObjectId or by name), preferring the user's copy over global.
    let folderDoc: any = null;

    if (Types.ObjectId.isValid(folderId)) {
      folderDoc =
        (await Folder.findOne({ _id: folderId, userEmail: email }).lean().exec()) ||
        (await Folder.findOne({ _id: folderId, userEmail: { $exists: false } }).lean().exec());
    } else {
      // Treat the param as a name
      const name = String(folderId);
      folderDoc =
        (await Folder.findOne({ name, userEmail: email }).lean().exec()) ||
        (await Folder.findOne({ name, userEmail: { $exists: false } }).lean().exec());
    }

    if (!folderDoc) {
      return res.status(404).json({ message: "Folder not found" });
    }

    const folderName = String(folderDoc.name || "");
    const nameRegex = new RegExp(`^${escapeRegex(folderName)}$`, "i");

    // 2) Fetch leads for this user:
    //    - Newer leads: match folderId === folderDoc._id
    //    - Legacy/imported leads: match folder name fields case-insensitively
    const leads = await Lead.find({
      ...userMatch(email),
      $or: [
        { folderId: folderDoc._id },
        { folderName: nameRegex },
        { Folder: nameRegex },
        { ["Folder Name"]: nameRegex },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(1000)
      .lean()
      .exec();

    const cleanedLeads: LeadType[] = (leads || []).map((l: any) => ({
      ...l,
      _id: String(l._id),
      folderId: l.folderId ? String(l.folderId) : null,
    }));

    return res.status(200).json({
      leads: cleanedLeads,
      folderName,
    });
  } catch (error) {
    console.error("❌ Fetch leads error:", error);
    return res.status(500).json({ message: "Error fetching leads" });
  }
}
