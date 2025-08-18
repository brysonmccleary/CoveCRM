import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const adminUser = await User.findOne({ email: session.user.email });
  if (!adminUser || adminUser.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const affiliates = await User.find({ affiliateApproved: true });

    const allMonthsSet = new Set<string>();

    const rows = affiliates.map((user) => {
      const history = user.commissionHistory || {};
      Object.keys(history).forEach((month) => allMonthsSet.add(month));

      return {
        name: user.name || user.email,
        history: history,
      };
    });

    const allMonths = Array.from(allMonthsSet).sort((a, b) => (a > b ? 1 : -1));

    return res.status(200).json({ rows, months: allMonths });
  } catch (err) {
    console.error("[ADMIN_AFFILIATE_EARNINGS_FETCH_ERROR]", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch affiliate earnings" });
  }
}
