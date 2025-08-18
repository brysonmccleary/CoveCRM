// /pages/api/dashboard/stats.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import CallLog from "@/models/CallLog";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userEmail = session.user.email;

  // Show stats for last 10 days
  const now = new Date();
  const startDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 9),
  );

  try {
    const results = await CallLog.aggregate([
      {
        $match: {
          userEmail: userEmail,
          timestamp: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$timestamp" },
            month: { $month: "$timestamp" },
            day: { $dayOfMonth: "$timestamp" },
          },
          dials: { $sum: 1 },
          talks: {
            $sum: {
              $cond: [{ $eq: ["$status", "connected"] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          date: {
            $dateFromParts: {
              year: "$_id.year",
              month: "$_id.month",
              day: "$_id.day",
            },
          },
          dials: 1,
          talks: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);

    // Convert date object to string
    const formattedResults = results.map((r) => ({
      ...r,
      date: r.date.toISOString().split("T")[0],
    }));

    return res.status(200).json({ data: formattedResults });
  } catch (err) {
    console.error("[DASHBOARD_STATS_ERROR]", err);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
}
