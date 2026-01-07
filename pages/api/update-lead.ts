// pages/api/update-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userEmail = session.user.email;
  const { leadId, status, notes, folderId } = req.body;

  try {
    await dbConnect();

    const updateFields: any = {};
    if (status) updateFields.status = status;
    if (notes) updateFields["Notes"] = notes; // match your schema field casing
    if (folderId) updateFields.folderId = new Types.ObjectId(folderId);

    const result = await Lead.updateOne(
      { _id: leadId, userEmail },
      { $set: updateFields },
    );

    if ((result as any).matchedCount === 0) {
      return res
        .status(404)
        .json({ message: "Lead not found or access denied" });
    }

    res.status(200).json({ message: "Lead updated successfully" });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
