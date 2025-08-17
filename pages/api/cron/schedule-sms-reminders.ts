// /pages/api/appointment/reminders.ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/dbConnect";
import Lead from "@/models/Lead";
import { sendSMS } from "@/lib/twilioClient";

// Utility function to compare timestamps in minute precision
function isWithinMinutes(target: Date, minutes: number): boolean {
  const now = new Date();
  const diff = Math.abs(target.getTime() - now.getTime());
  return diff <= minutes * 60 * 1000;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  await dbConnect();

  const now = new Date();
  const leads = await Lead.find({
    appointmentTime: { $gte: new Date(now.getTime() - 6 * 60 * 60 * 1000) }, // check last 6 hours
  });

  for (const lead of leads) {
    if (!lead.phone || !lead.appointmentTime) continue;

    const appt = new Date(lead.appointmentTime);
    const minutesUntil = Math.round((appt.getTime() - now.getTime()) / 60000);
    const dateToday = now.toDateString() === appt.toDateString();

    // Agent name fallback
    const agentName = lead.assignedAgentName || "your agent";

    // Ensure reminder tracking exists
    if (!lead.remindersSent) {
      lead.remindersSent = {
        morning: false,
        oneHour: false,
        fifteenMin: false,
      };
    }

    // Morning-of (sent before 9am)
    if (
      dateToday &&
      now.getHours() < 9 &&
      !lead.remindersSent.morning
    ) {
      await sendSMS({
        to: lead.phone,
        body: `Good morning! Just a reminder that you have a call today with ${agentName}.`,
      });
      lead.remindersSent.morning = true;
    }

    // 1 Hour Before
    if (
      minutesUntil <= 60 &&
      minutesUntil > 45 &&
      !lead.remindersSent.oneHour
    ) {
      await sendSMS({
        to: lead.phone,
        body: `Just a heads-up! ${agentName} will be calling you in about 1 hour for your scheduled appointment.`,
      });
      lead.remindersSent.oneHour = true;
    }

    // 15 Min Before
    if (
      minutesUntil <= 15 &&
      minutesUntil > 10 &&
      !lead.remindersSent.fifteenMin
    ) {
      await sendSMS({
        to: lead.phone,
        body: `Reminder: Your appointment is in about 15 minutes. Get ready for your call from ${agentName}.`,
      });
      lead.remindersSent.fifteenMin = true;
    }

    await lead.save();
  }

  return res.status(200).json({ message: "SMS reminders processed successfully" });
}
