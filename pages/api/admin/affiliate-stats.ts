// /pages/api/admin/affiliate-stats.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session || session.user.role !== "admin") {
    return res.status(403).json({ message: "Unauthorized" });
  }

  await dbConnect();

  try {
    const users = await User.find({ subscriptionStatus: "active", referredBy: { $ne: null } });

    const codeCounts: Record<string, number> = {};
    users.forEach((user) => {
      const code = user.referredBy!;
      codeCounts[code] = (codeCounts[code] || 0) + 1;
    });

    const data = Object.entries(codeCounts).map(([code, count]) => ({ code, count }));
    res.status(200).json({ data });
  } catch (error) {
    console.error("Error fetching affiliate stats:", error);
    res.status(500).json({ message: "Server error" });
  }
}
