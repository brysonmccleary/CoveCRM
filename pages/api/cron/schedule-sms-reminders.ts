// /pages/api/cron/schedule-sms-reminders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { checkAndSendReminders } from "@/lib/utils/scheduleReminders";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    // ✅ Protect against public spam hits (only enforced if CRON_SECRET is set)
    const expected = (process.env.CRON_SECRET || "").trim();
    const token = String((req.query.token as string | undefined) || "").trim();
    if (expected && token !== expected) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // ✅ Use the Booking-based reminder system (not Lead.appointmentTime)
    await checkAndSendReminders();

    // Keep the same response string your curl/test expects
    return res.status(200).json({ message: "SMS reminders processed successfully" });
  } catch (err: any) {
    console.error("[schedule-sms-reminders] error:", err?.message || err);
    return res.status(500).json({ message: "Failed to process SMS reminders" });
  }
}
