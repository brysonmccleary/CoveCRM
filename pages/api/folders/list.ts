import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/folder";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await dbConnect();

    const folders = await Folder.find({ userEmail: session.user.email })
      .select("_id name")
      .lean();

    return res.status(200).json({ folders });
  } catch (error) {
    console.error("Error fetching folders:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
