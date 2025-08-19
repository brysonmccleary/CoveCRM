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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await dbConnect();
    const user = await getUserByEmail(session.user.email);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { dripAlerts, bookingConfirmations } = req.body;

    // Fallback logic to preserve existing values if undefined
    const updatedNotifications = {
      dripAlerts:
        typeof dripAlerts === "boolean"
          ? dripAlerts
          : (user.notifications?.dripAlerts ?? true),
      bookingConfirmations:
        typeof bookingConfirmations === "boolean"
          ? bookingConfirmations
          : (user.notifications?.bookingConfirmations ?? true),
    };

    user.notifications = {
      ...user.notifications,
      ...updatedNotifications,
    };

    await user.save();

    return res
      .status(200)
      .json({ success: true, message: "Notification settings updated." });
  } catch (error) {
    console.error("Error updating notification settings:", error);
    return res
      .status(500)
      .json({ error: "Failed to update notification settings." });
  }
}
