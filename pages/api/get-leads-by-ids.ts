// /pages/api/get-lead-by-id.ts
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
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const { id } = req.query;

  if (!id || typeof id !== "string" || !Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Missing or invalid lead ID" });
  }

  try {
    await dbConnect();
    const lead = await Lead.findOne({ _id: id, userEmail });

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    res.status(200).json({ lead });
  } catch (error) {
    console.error("Error fetching lead by ID:", error);
    res.status(500).json({ message: "Server error" });
  }
}
