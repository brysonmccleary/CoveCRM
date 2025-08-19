// /pages/api/leads/by-event/[id].ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import { getToken } from "next-auth/jwt";
import Lead from "@/models/Lead";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const token = await getToken({ req });
  if (!token || !token.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  const { id: calendarEventId } = req.query;

  try {
    const lead = await Lead.findOne({
      userEmail: token.email,
      calendarEventId,
    }).lean();

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    return res.status(200).json({ lead });
  } catch (err: any) {
    console.error("❌ Error fetching lead by event ID:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
