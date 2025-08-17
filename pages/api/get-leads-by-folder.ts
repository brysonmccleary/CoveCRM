// pages/api/get-leads-by-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import mongoose from "mongoose";

interface LeadType {
  _id: string;
  folderId: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  state?: string;
  age?: number;
  [key: string]: any;
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
    console.log("✅ Connected to DB (get-leads-by-folder)");

    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userEmail = session.user.email.toLowerCase();
    let folderObjectId: mongoose.Types.ObjectId | null = null;

    if (mongoose.Types.ObjectId.isValid(folderId)) {
      folderObjectId = new mongoose.Types.ObjectId(folderId);
    } else {
      const folderDoc = await Folder.findOne({ name: folderId, userEmail });
      if (!folderDoc) {
        return res.status(404).json({ message: `Folder '${folderId}' not found` });
      }
      folderObjectId = folderDoc._id;
      console.log(`✅ Resolved folder '${folderId}' to ObjectId: ${folderObjectId}`);
    }

    const leads = await Lead.find({
      folderId: folderObjectId,
      userEmail,
    })
      .sort({ createdAt: -1 })
      .limit(1000);

    const cleanedLeads = leads.map((lead) => ({
      ...lead.toObject(),
      _id: lead._id.toString(),
      folderId: lead.folderId.toString(),
    }));

    console.log(`📦 Returning ${cleanedLeads.length} leads from folder ${folderObjectId}`);

    return res.status(200).json({
      leads: cleanedLeads as LeadType[],
      folderName: folderId,
    });
  } catch (error) {
    console.error("❌ Fetch leads error:", error);
    return res.status(500).json({ message: "Error fetching leads" });
  }
}
