// /pages/api/leads/by-event-ids.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]"; // ← correct relative path
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const eventIds = Array.isArray((req.body as any)?.eventIds)
    ? ((req.body as any).eventIds as any[]).filter(Boolean).map(String)
    : [];

  if (eventIds.length === 0) {
    return res.status(400).json({ message: "eventIds[] required" });
  }

  try {
    await dbConnect();

    const rows = await Lead.find(
      { userEmail, calendarEventId: { $in: eventIds } },
      { _id: 1, calendarEventId: 1 }
    ).lean();

    const map: Record<string, string> = {};
    for (const r of rows) {
      if (r.calendarEventId) map[r.calendarEventId] = String(r._id);
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ map, count: rows.length });
  } catch (err) {
    console.error("❌ Error mapping eventIds to leads:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
