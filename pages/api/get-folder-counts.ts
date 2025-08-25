import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    const counts = await Lead.aggregate([
      {
        $match: {
          $or: [{ userEmail: email }, { ownerEmail: email }, { user: email }],
          folderId: { $exists: true, $ne: null },
        },
      },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]).exec();

    const map: Record<string, number> = {};
    for (const c of counts) map[String(c._id)] = c.count;

    res.status(200).json({ counts: map });
  } catch (err) {
    console.error("Error fetching folder counts:", err);
    res.status(500).json({ message: "Error fetching folder counts" });
  }
}
