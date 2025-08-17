import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { agentEmail, time } = req.body;

  if (!agentEmail || !time) {
    return res.status(400).json({ message: "Missing agentEmail or time" });
  }

  await dbConnect();

  const user = await User.findOne({ email: agentEmail });
  if (!user) {
    return res.status(404).json({ message: "Agent not found" });
  }

  // If you ever re-enable checking, this is where token logic would go.
  // For now, we skip everything and allow all bookings.

  return res.status(200).json({
    conflict: false,
    message: "Booking allowed (conflict checks disabled).",
  });
}
