// lib/utils/scheduleReminders.ts
import dbConnect from "@/lib/mongooseConnect";
import Booking from "@/models/Booking";
import { sendSMS } from "@/lib/twilio/sendSMS";
import { DateTime } from "luxon";

// Format: "2:30 PM"
const formatTime = (dt: DateTime) => dt.toLocaleString(DateTime.TIME_SIMPLE);

// Format: "August 5, 2025"
const formatDate = (dt: DateTime) =>
  dt.toLocaleString({ month: "long", day: "numeric", year: "numeric" });

export async function checkAndSendReminders() {
  await dbConnect();

  const nowUTC = DateTime.utc();

  const upcoming = await Booking.find({
    date: {
      $gte: new Date(Date.now() - 15 * 60_000), // 15 min ago
      $lte: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hrs ahead
    },
  });

  for (const booking of upcoming) {
    const {
      date,
      leadPhone,
      agentPhone,
      agentEmail,
      reminderSent,
      timezone,
    } = booking as any;

    // We must know which tenant/user is sending the SMS (used for billing/A2P/etc.)
    if (!agentEmail) {
      console.warn("⚠️ Skipping reminder: booking has no agentEmail.");
      continue;
    }

    // Ensure reminder flags object exists to prevent runtime errors
    if (!booking.reminderSent) {
      booking.reminderSent = { confirm: false, morning: false, hour: false, fifteen: false };
    }

    const tz = timezone || "America/New_York";
    const bookingTime = DateTime.fromJSDate(date, { zone: tz });
    const nowLocal = nowUTC.setZone(tz);
    const timeDiffMs = bookingTime.toMillis() - nowLocal.toMillis();

    const dateStr = formatDate(bookingTime);
    const timeStr = formatTime(bookingTime);

    // ✅ 1. Confirmation (send once, any time > 1 minute before)
    if (!booking.reminderSent.confirm && timeDiffMs > 60 * 1000) {
      console.log(`📨 Sending confirmation to ${leadPhone}`);
      await sendSMS(
        leadPhone,
        `We’re all set! Quick details:\n\n📅 ${dateStr}\n⏰ ${timeStr}\n📞 Call from ${agentPhone || "your agent"}`,
        agentEmail // identify tenant/user for A2P, usage, etc.
      );
      booking.reminderSent.confirm = true;
    }

    // ✅ 2. Morning-of (7–9am local time, same day)
    const isMorningOf =
      nowLocal.hasSame(bookingTime, "day") &&
      nowLocal.hour >= 7 &&
      nowLocal.hour <= 9 &&
      timeDiffMs > 60 * 60 * 1000;

    if (!booking.reminderSent.morning && isMorningOf) {
      console.log(`🌅 Sending morning-of reminder to ${leadPhone}`);
      await sendSMS(
        leadPhone,
        `Good morning! Just a quick reminder of your appointment with ${agentEmail} today at ${timeStr}.`,
        agentEmail
      );
      booking.reminderSent.morning = true;
    }

    // ✅ 3. 1 hour before
    if (!booking.reminderSent.hour && timeDiffMs <= 60 * 60 * 1000 && timeDiffMs > 30 * 60 * 1000) {
      console.log(`⏰ Sending 1-hour reminder to ${leadPhone}`);
      await sendSMS(
        leadPhone,
        `Heads up! ${agentEmail} will be calling in about an hour.`,
        agentEmail
      );
      booking.reminderSent.hour = true;
    }

    // ✅ 4. 15 minutes before
    if (!booking.reminderSent.fifteen && timeDiffMs <= 15 * 60 * 1000 && timeDiffMs > 0) {
      console.log(`⚠️ Sending 15-min reminder to ${leadPhone}`);
      await sendSMS(
        leadPhone,
        `Just another heads up — your appointment is in 15 minutes. Talk soon!`,
        agentEmail
      );
      booking.reminderSent.fifteen = true;
    }

    await booking.save();
  }

  console.log("✅ All reminders processed");
}
