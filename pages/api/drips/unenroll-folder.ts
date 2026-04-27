// pages/api/drips/unenroll-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";

type Body = {
  folderId?: string;
  campaignId?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const { folderId, campaignId }: Body = req.body || {};
    if (!folderId || !campaignId) return res.status(400).json({ error: "folderId and campaignId are required" });

    await dbConnect();

    const upd = await DripFolderEnrollment.updateOne(
      { userEmail: session.user.email, folderId, campaignId, active: true },
      { $set: { active: false } }
    );

    return res.status(200).json({
      success: true,
      matched: upd.matchedCount,
      modified: upd.modifiedCount,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}
