import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import LeadModel from "@/models/Lead"; // ✅ Make sure you have this model
import mongoose from "mongoose";

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

  const { leadId, notes } = req.body;
  const userEmail = session.user.email;

  if (!leadId || !notes) {
    return res.status(400).json({ message: "Missing 'leadId' or 'notes'" });
  }

  try {
    await dbConnect();

    const result = await LeadModel.updateOne(
      { _id: new mongoose.Types.ObjectId(leadId), user: userEmail },
      { $set: { Notes: notes } },
    );

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ message: "Lead not found or access denied" });
    }

    return res.status(200).json({ message: "Notes updated successfully" });
  } catch (error: any) {
    console.error("Error updating notes:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
}
