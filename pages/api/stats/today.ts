// /pages/api/stats/today.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import { DateTime } from "luxon";
import { resolveTimezoneFromRequest } from "@/lib/resolveTimezone";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  try {
    await dbConnect();

    // 🌍 Resolve user's timezone (query/header/Vercel/cookie; fallback UTC)
    const tz = resolveTimezoneFromRequest(req, "UTC");

    // Use [startOfDay, nextStartOfDay) to avoid 23:59:59.999 edge cases
    const start = DateTime.now().setZone(tz).startOf("day");
    const next = start.plus({ days: 1 });
    const startJS = start.toJSDate();
    const nextJS = next.toJSDate();

    // Count a call if either startedAt OR completedAt falls within today.
    const todayWindow = {
      $or: [
        { startedAt: { $gte: startJS, $lt: nextJS } },
        { completedAt: { $gte: startJS, $lt: nextJS } },
      ],
    };
    const base = { userEmail, ...todayWindow };

    const [dailyCalls, dailyTalks] = await Promise.all([
      Call.countDocuments(base),
      Call.countDocuments({ ...base, talkTime: { $gt: 0 } }),
    ]);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ dailyCalls, dailyTalks, tz });
  } catch (err: any) {
    console.error("GET /api/stats/today error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}
