// /pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  // ✅ Properly typed session
  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const authedEmail = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!authedEmail) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, newFolderName } = (req.body ?? {}) as { leadId?: string; newFolderName?: string };
  if (!leadId || !newFolderName?.trim()) {
    return res.status(400).json({ message: "Missing required fields." });
  }
  const targetName = newFolderName.trim();

  try {
    await dbConnect();

    // ✅ Find the lead for this user (support legacy ownerEmail as well)
    const lead = await Lead.findOne({
      _id: leadId,
      $or: [{ userEmail: authedEmail }, { ownerEmail: authedEmail }],
    });
    if (!lead) return res.status(404).json({ message: "Lead not found." });

    // ✅ Find (or create) the destination folder scoped to this user
    let folder = await Folder.findOne({
      name: targetName,
      $or: [{ userEmail: authedEmail }, { ownerEmail: authedEmail }],
    });

    if (!folder) {
      // Create with BOTH fields so all parts of the app can see it
      folder = await Folder.create({
        name: targetName,
        userEmail: authedEmail,
        ownerEmail: authedEmail,
        assignedDrips: [],
      });
    }

    // ✅ Move and mirror status
    const fromFolderId = lead.folderId ? String(lead.folderId) : null;
    lead.folderId = folder._id;
    lead.status = targetName;
    await lead.save();

    // 👍 Best-effort history entry (doesn't block)
    try {
      await Lead.updateOne(
        { _id: lead._id },
        {
          $push: {
            interactionHistory: {
              type: "status",
              from: fromFolderId,
              to: targetName,
              date: new Date(),
            },
          },
        }
      );
    } catch {}

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      fromFolderId,
      toFolderId: String(folder._id),
      leadId: String(lead._id),
      status: lead.status,
    });
  } catch (e) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}
