// /pages/api/move-lead-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import mongoose from "mongoose";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

const SYSTEM = new Set(["not interested", "booked appointment", "sold", "resolved"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, newFolderName } = req.body as { leadId?: string; newFolderName?: string };
  const nameRaw = String(newFolderName || "").trim();
  if (!leadId || !nameRaw) {
    return res.status(400).json({ message: "leadId and newFolderName are required" });
  }

  await dbConnect();

  const sessionMongo = await mongoose.startSession();
  try {
    let toFolderId: mongoose.Types.ObjectId | null = null;

    await sessionMongo.withTransaction(async () => {
      // 1) Verify lead belongs to this user
      const lead = await Lead.findOne({ _id: leadId, userEmail })
        .select({ _id: 1, status: 1 })
        .session(sessionMongo)
        .lean<{ _id: any; status?: string } | null>();
      if (!lead) throw new Error("Lead not found or not owned by user");

      // 2) Resolve or create destination folder (case-insensitive exact)
      const nameRegex = new RegExp(`^${escapeRegex(nameRaw)}$`, "i");
      const folder = await Folder.findOneAndUpdate(
        { userEmail, name: nameRegex },
        { $setOnInsert: { userEmail, name: nameRaw, assignedDrips: [] as string[] } },
        { new: true, upsert: true, session: sessionMongo }
      ).select({ _id: 1, name: 1 });

      toFolderId = folder!._id as any;

      // 3) Move lead; only set status if system folder
      const setFields: any = {
        folderId: toFolderId,
        updatedAt: new Date(),
      };
      if (SYSTEM.has(nameRaw.toLowerCase())) {
        setFields.status = nameRaw;
      }

      const result = await Lead.updateOne(
        { _id: leadId, userEmail },
        { $set: setFields },
        { session: sessionMongo }
      );
      if (result.matchedCount === 0) throw new Error("Lead not found in update");
    });

    return res.status(200).json({
      success: true,
      message: "Lead moved successfully",
      folderId: String(toFolderId),
    });
  } catch (error) {
    console.error("Move lead error:", error);
    return res.status(500).json({ message: "Error moving lead" });
  } finally {
    sessionMongo.endSession();
  }
}

// local
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
