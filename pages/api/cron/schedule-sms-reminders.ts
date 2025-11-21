// /pages/api/appointment/reminders.ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/dbConnect";
import Lead from "@/models/Lead";
import { sendSMS } from "@/lib/twilioClient";
import { DateTime } from "luxon";

// --- Timezone helper (mirror of other files) ---
function pickLeadZone(lead: any): string {
  const s = String(lead?.State || (lead as any)?.state || "").trim();
  const byState: Record<string, string> = {
    AZ: "America/Phoenix",
    CA: "America/Los_Angeles",
    NV: "America/Los_Angeles",
    OR: "America/Los_Angeles",
    WA: "America/Los_Angeles",
    CO: "America/Denver",
    MT: "America/Denver",
    NM: "America/Denver",
    UT: "America/Denver",
    WY: "America/Denver",
    AL: "America/Chicago",
    AR: "America/Chicago",
    IA: "America/Chicago",
    IL: "America/Chicago",
    KS: "America/Chicago",
    KY: "America/New_York",
    LA: "America/Chicago",
    MN: "America/Chicago",
    MO: "America/Chicago",
    MS: "America/Chicago",
    ND: "America/Chicago",
    NE: "America/Chicago",
    OK: "America/Chicago",
    SD: "America/Chicago",
    TN: "America/Chicago",
    TX: "America/Chicago",
    CT: "America/New_York",
    DC: "America/New_York",
    DE: "America/New_York",
    FL: "America/New_York",
    GA: "America/New_York",
    MA: "America/New_York",
    MD: "America/New_York",
    ME: "America/New_York",
    MI: "America/New_York",
    NC: "America/New_York",
    NH: "America/New_York",
    NJ: "America/New_York",
    NY: "America/New_York",
    OH: "America/New_York",
    PA: "America/New_York",
    RI: "America/New_York",
    SC: "America/New_York",
    VA: "America/New_York",
    VT: "America/New_York",
    AK: "America/Anchorage",
    HI: "Pacific/Honolulu",
  };
  const key = s.toUpperCase().replace(/[^A-Z]/g, "");
  return byState[key] || "America/New_York";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  await dbConnect();

  // Work off a single "now" in UTC, then convert per-lead
  const nowUtc = DateTime.utc();
  const sixHoursAgoUtc = nowUtc.minus({ hours: 6 }).toJSDate();

  const leads = await Lead.find({
    appointmentTime: { $gte: sixHoursAgoUtc }, // check last 6 hours
  });

  for (const lead of leads) {
    const phone =
      (lead as any).phone ||
      (lead as any).Phone ||
      (lead as any)["Phone Number"] ||
      (lead as any).Mobile;

    if (!phone || !lead.appointmentTime) continue;

    const zone = pickLeadZone(lead);
    const nowZ = nowUtc.setZone(zone);
    const apptZ = DateTime.fromJSDate(lead.appointmentTime).setZone(zone);

    // ❌ Never send any reminder after the appointment time (lead-local)
    const minutesUntil = apptZ.diff(nowZ, "minutes").as("minutes");
    if (minutesUntil <= 0) {
      continue;
    }

    const dateToday = nowZ.toISODate() === apptZ.toISODate();

    // Agent name fallback
    const agentName = (lead as any).assignedAgentName || "your agent";

    // Ensure reminder tracking exists
    if (!lead.remindersSent) {
      (lead as any).remindersSent = {
        morning: false,
        oneHour: false,
        fifteenMin: false,
      };
    }

    const remindersSent = (lead as any).remindersSent || {
      morning: false,
      oneHour: false,
      fifteenMin: false,
    };

    // Morning-of (sent before 9am lead-local)
    if (dateToday && nowZ.hour < 9 && !remindersSent.morning) {
      await sendSMS({
        to: phone,
        body: `Good morning! Just a reminder that you have a call today with ${agentName}.`,
      });
      remindersSent.morning = true;
    }

    // 1 Hour Before (in a 45–60 min window)
    if (
      minutesUntil <= 60 &&
      minutesUntil > 45 &&
      !remindersSent.oneHour
    ) {
      await sendSMS({
        to: phone,
        body: `Just a heads-up! ${agentName} will be calling you in about 1 hour for your scheduled appointment.`,
      });
      remindersSent.oneHour = true;
    }

    // 15 Min Before (in a 10–15 min window)
    if (
      minutesUntil <= 15 &&
      minutesUntil > 10 &&
      !remindersSent.fifteenMin
    ) {
      await sendSMS({
        to: phone,
        body: `Reminder: Your appointment is in about 15 minutes. Get ready for your call from ${agentName}.`,
      });
      remindersSent.fifteenMin = true;
    }

    (lead as any).remindersSent = remindersSent;
    await lead.save();
  }

  return res
    .status(200)
    .json({ message: "SMS reminders processed successfully" });
}
