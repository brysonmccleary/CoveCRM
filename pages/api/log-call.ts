// /pages/api/log-call.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseconnect";
import CallLog from "@/models/CallLog";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId, leadId, phoneNumber, status, durationSeconds } = req.body;

    if (!userId || !phoneNumber || !status) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const log = await CallLog.create({
      userId,
      leadId: leadId || undefined,
      phoneNumber,
      status,
      durationSeconds: durationSeconds || undefined,
      timestamp: new Date(),
    });

    return res.status(200).json({ success: true, log });
  } catch (error: any) {
    console.error("❌ Error logging call:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
