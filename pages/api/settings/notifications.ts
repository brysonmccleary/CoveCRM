// pages/api/settings/update-notifications.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Authenticate the user session
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { dripAlerts, bookingConfirmations } = req.body;

  try {
    // Connect to MongoDB
    await dbConnect();

    // Load the user
    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Safely update notification preferences
    user.notifications = {
      ...user.notifications,
      dripAlerts:
        typeof dripAlerts === "boolean"
          ? dripAlerts
          : (user.notifications?.dripAlerts ?? true),
      bookingConfirmations:
        typeof bookingConfirmations === "boolean"
          ? bookingConfirmations
          : (user.notifications?.bookingConfirmations ?? true),
    };

    // Save the changes
    await user.save();

    // Success response
    return res
      .status(200)
      .json({ message: "Notification preferences updated." });
  } catch (error) {
    console.error("Error updating notifications:", error);
    return res.status(500).json({ error: "Failed to update notifications." });
  }
}
