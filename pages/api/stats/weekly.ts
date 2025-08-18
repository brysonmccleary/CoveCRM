// /pages/api/stats/weekly.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import { DateTime } from "luxon";
import { resolveTimezoneFromRequest } from "@/lib/resolveTimezone";

/**
 * Returns the last 7 calendar days (including today) in the user's timezone.
 * Each day contains: { date: 'YYYY-MM-DD', calls: number, talks: number }
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  try {
    await dbConnect();

    const tz = resolveTimezoneFromRequest(req, "UTC");

    // Compute day buckets [startOfDay, nextStart) for last 7 days in user's TZ
    const today = DateTime.now().setZone(tz).startOf("day");
    const buckets = Array.from({ length: 7 }).map((_, i) => {
      const start = today.minus({ days: 6 - i });
      const end = start.plus({ days: 1 });
      return { start, end, key: start.toFormat("yyyy-LL-dd") };
    });

    // Query window: from oldest start to newest end
    const overallStart = buckets[0].start.toJSDate();
    const overallEnd = buckets[6].end.toJSDate();

    // Pull all candidate calls once (user-scoped)
    const calls = await Call.find({
      userEmail,
      $or: [
        { startedAt: { $gte: overallStart, $lt: overallEnd } },
        { completedAt: { $gte: overallStart, $lt: overallEnd } },
      ],
    })
      .select("startedAt completedAt talkTime")
      .lean();

    // Helper to test if a call falls in a given bucket (by either startedAt or completedAt)
    const inBucket = (c: any, startJS: Date, endJS: Date) => {
      const s = c.startedAt ? new Date(c.startedAt).getTime() : undefined;
      const e = c.completedAt ? new Date(c.completedAt).getTime() : undefined;
      const a = startJS.getTime();
      const b = endJS.getTime();
      return (
        (s !== undefined && s >= a && s < b) ||
        (e !== undefined && e >= a && e < b)
      );
    };

    const result = buckets.map(({ start, end, key }) => {
      const startJS = start.toJSDate();
      const endJS = end.toJSDate();

      let callsCount = 0;
      let talksCount = 0;

      for (const c of calls) {
        if (inBucket(c, startJS, endJS)) {
          callsCount += 1;
          if ((c.talkTime || 0) > 0) talksCount += 1;
        }
      }

      return { date: key, calls: callsCount, talks: talksCount };
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ tz, days: result });
  } catch (err: any) {
    console.error("GET /api/stats/weekly error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}
