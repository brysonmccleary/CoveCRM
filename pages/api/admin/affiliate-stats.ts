// /pages/api/admin/affiliate-stats.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

type AffiliateStat = { code: string; count: number };
type ApiResponse =
  | { data: AffiliateStat[] }
  | { message: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  const session = await getServerSession(req, res, authOptions);

  // Guard against missing session or user
  if (!session || !session.user || session.user.role !== "admin") {
    return res.status(403).json({ message: "Unauthorized" });
  }

  await dbConnect();

  try {
    const users = await User.find({
      subscriptionStatus: "active",
      referredBy: { $ne: null },
    }).lean();

    const codeCounts: Record<string, number> = {};
    for (const u of users) {
      const code = (u as any).referredBy as string | undefined;
      if (!code) continue;
      codeCounts[code] = (codeCounts[code] || 0) + 1;
    }

    const data = Object.entries(codeCounts).map(([code, count]) => ({
      code,
      count,
    }));

    return res.status(200).json({ data });
  } catch (error) {
    console.error("Error fetching affiliate stats:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
