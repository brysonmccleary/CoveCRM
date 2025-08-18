// /pages/api/cron/reminders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { checkAndSendReminders } from "@/utils/scheduleReminders";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";

// Optional: allow GET from CRON or CLI ping
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user?.email) {
    console.log("🔒 Unauthorized reminder trigger attempt");
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    console.log("🔁 Running reminder check for:", session.user.email);
    await checkAndSendReminders();
    console.log("✅ Reminder check complete");
    return res.status(200).json({ status: "Reminder check complete" });
  } catch (err) {
    console.error("❌ Reminder check failed:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}
