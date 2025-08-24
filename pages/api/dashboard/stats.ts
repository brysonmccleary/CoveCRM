// /pages/api/dashboard/stats.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import CallLog from "@/models/CallLog";
import Message from "@/models/Message";

type Row = { date: string; dials: number; talks: number };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const userEmail = String(session.user.email).toLowerCase();

  // last 10 days, starting 9 days ago at 00:00:00 UTC
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 9, 0, 0, 0, 0));

  try {
    // -------- Aggregate from Message (if you log calls in Message) --------
    const msgPipeline = [
      {
        $project: {
          userEmail: 1,
          direction: 1,
          kind: 1,
          status: 1,
          // prefer createdAt; fall back to receivedAt/sentAt
          eventAt: { $ifNull: ["$createdAt", { $ifNull: ["$receivedAt", "$sentAt"] }] },
        },
      },
      { $match: { userEmail, eventAt: { $gte: from } } },
      {
        $project: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$eventAt" } },
          direction: 1,
          kind: 1,
          status: 1,
        },
      },
      {
        $group: {
          _id: "$day",
          dials: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$direction", "outbound"] }, { $eq: ["$kind", "call"] }] },
                1,
                0,
              ],
            },
          },
          talks: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$kind", "call"] }, { $in: ["$status", ["answered", "completed", "connected"]] }] },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ] as any[];

    // -------- Aggregate from CallLog (your current model) --------
    const callLogPipeline = [
      { $match: { userEmail, timestamp: { $gte: from } } },
      {
        $project: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
          // Normalize values safely
          statusLower: { $toLower: { $ifNull: ["$status", ""] } },
          direction: { $ifNull: ["$direction", ""] },
          kind: { $ifNull: ["$kind", ""] },
          type: { $ifNull: ["$type", ""] },
        },
      },
      {
        $group: {
          _id: "$day",
          dials: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $regexMatch: { input: "$direction", regex: "^outbound", options: "i" } },
                    { $eq: ["$type", "dial"] },
                    { $eq: ["$kind", "call"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          talks: {
            $sum: {
              $cond: [
                { $in: ["$statusLower", ["connected", "answered", "completed"]] },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ] as any[];

    const [msgRows, callRows] = await Promise.all([
      (Message as any).aggregate(msgPipeline),
      (CallLog as any).aggregate(callLogPipeline),
    ]);

    // Combine the two sources day-by-day
    const byDay = new Map<string, { dials: number; talks: number }>();

    for (const r of msgRows || []) {
      byDay.set(r._id, {
        dials: (byDay.get(r._id)?.dials || 0) + (r.dials || 0),
        talks: (byDay.get(r._id)?.talks || 0) + (r.talks || 0),
      });
    }
    for (const r of callRows || []) {
      byDay.set(r._id, {
        dials: (byDay.get(r._id)?.dials || 0) + (r.dials || 0),
        talks: (byDay.get(r._id)?.talks || 0) + (r.talks || 0),
      });
    }

    // Return as array sorted by date asc, with {date, dials, talks}
    const data: Row[] = Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, vals]) => ({ date, dials: vals.dials || 0, talks: vals.talks || 0 }));

    return res.status(200).json({ data });
  } catch (err) {
    console.error("[DASHBOARD_STATS_ERROR]", err);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
}
