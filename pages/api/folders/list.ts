import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const rawEmail = session?.user?.email;
  if (!rawEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await dbConnect();

    // Normalize to lowercase to match how imports store userEmail
    const userEmail = String(rawEmail).toLowerCase();

    /**
     * Sort newest activity first, then newest creation, then name ASC for stability.
     * Selecting a few useful fields; add/remove as your UI needs.
     */
    const folders = await Folder.find({ userEmail })
      .select("_id name lastActivityAt createdAt")
      .sort({ lastActivityAt: -1, createdAt: -1, name: 1 })
      .lean();

    return res.status(200).json({ folders });
  } catch (error) {
    console.error("Error fetching folders:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
