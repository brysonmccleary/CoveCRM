// lib/utils/scheduleReminders.ts
import dbConnect from "@/lib/mongooseConnect";
import Booking from "@/models/Booking";
import { sendSMS } from "@/lib/twilio/sendSMS";
import { DateTime } from "luxon";

// Derive the DateTime instance type without importing Luxon types directly
type LuxonDateTime = ReturnType<typeof DateTime.fromJSDate>;

// Format: "2:30 PM"
const formatTime = (dt: LuxonDateTime) => dt.toLocaleString(DateTime.TIME_SIMPLE);

// Format: "August 5, 2025"
const formatDate = (dt: LuxonDateTime) =>
  dt.toLocaleString({ month: "long", day: "numeric", year: "numeric" });

function withStopFooter(msg: string) {
  return /reply stop to opt out/i.test(msg)
    ? msg
    : `${msg} Reply STOP to opt out.`;
}

function safeTz(input: any) {
  const tz = (typeof input === "string" && input.trim()) ? input.trim() : "";
  // Luxon will treat invalid zones as "invalid"; we can guard by checking isValid.
  const test = DateTime.utc().setZone(tz || "America/New_York");
  return test.isValid ? (tz || "America/New_York") : "America/New_York";
}

/**
 * Atomic "claim" for a reminder so multiple invocations don't double-send.
 * We only proceed if we successfully flipped the flag from false->true.
 *
 * NOTE: If sendSMS fails, we revert the flag so a later run can retry.
 */
async function claimReminder(bookingId: any, key: "confirm" | "morning" | "hour" | "fifteen") {
  // Ensure reminderSent exists AND the target key is not true.
  const updated = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      $or: [
        { reminderSent: { $exists: false } },
        { [`reminderSent.${key}`]: { $ne: true } },
      ],
    },
    {
      $setOnInsert: {
        reminderSent: { confirm: false, morning: false, hour: false, fifteen: false },
      },
      $set: {
        [`reminderSent.${key}`]: true,
      },
    },
    { new: true }
  );

  // If null, someone else already claimed/sent it.
  return updated;
}

async function revertReminder(bookingId: any, key: "confirm" | "morning" | "hour" | "fifteen") {
  try {
    await Booking.updateOne(
      { _id: bookingId },
      { $set: { [`reminderSent.${key}`]: false } }
    );
  } catch (e) {
    // non-blocking; we tried
    console.warn("⚠️ Failed to revert reminder flag after send failure:", e);
  }
}

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
    const { date, leadPhone, agentPhone, agentEmail, timezone } = booking as any;

    if (!agentEmail) {
      console.warn("⚠️ Skipping reminder: booking has no agentEmail.");
      continue;
    }

    const tz = safeTz(timezone);
    const bookingTime = DateTime.fromJSDate(date, { zone: tz });
    const nowLocal = nowUTC.setZone(tz);
    const timeDiffMs = bookingTime.toMillis() - nowLocal.toMillis();

    const dateStr = formatDate(bookingTime);
    const timeStr = formatTime(bookingTime);

    // ✅ 1. Confirmation (send once, any time > 1 minute before)
    if (timeDiffMs > 60 * 1000) {
      // Concurrency-safe claim
      const claimed = await claimReminder(booking._id, "confirm");
      if (claimed) {
        try {
          console.log(`📨 Sending confirmation to ${leadPhone}`);
          await sendSMS(
            leadPhone,
            withStopFooter(`We’re all set! Quick details:\n\n📅 ${dateStr}\n⏰ ${timeStr}\n📞 Call from ${agentPhone || "your agent"}`),
            agentEmail,
            { source: "booking_confirmation" }
          );
        } catch (err) {
          console.error("❌ Confirmation SMS failed:", err);
          // Allow retry next run
          await revertReminder(booking._id, "confirm");
        }
      }
    }

    // ✅ 2. Morning-of (7–9am local time, same day)
    const isMorningOf =
      nowLocal.hasSame(bookingTime, "day") &&
      nowLocal.hour >= 7 &&
      nowLocal.hour <= 9 &&
      timeDiffMs > 60 * 60 * 1000;

    if (isMorningOf) {
      const claimed = await claimReminder(booking._id, "morning");
      if (claimed) {
        try {
          console.log(`🌅 Sending morning-of reminder to ${leadPhone}`);
          await sendSMS(
            leadPhone,
            withStopFooter(`Good morning! Just a quick reminder of your appointment with ${agentEmail} today at ${timeStr}.`),
            agentEmail,
            { source: "booking_reminder" }
          );
        } catch (err) {
          console.error("❌ Morning-of SMS failed:", err);
          await revertReminder(booking._id, "morning");
        }
      }
    }

    // ✅ 3. 1 hour before
    const isHourBefore =
      timeDiffMs <= 60 * 60 * 1000 && timeDiffMs > 30 * 60 * 1000;

    if (isHourBefore) {
      const claimed = await claimReminder(booking._id, "hour");
      if (claimed) {
        try {
          console.log(`⏰ Sending 1-hour reminder to ${leadPhone}`);
          await sendSMS(
            leadPhone,
            withStopFooter(`Heads up! ${agentEmail} will be calling in about an hour.`),
            agentEmail,
            { source: "booking_reminder" }
          );
        } catch (err) {
          console.error("❌ 1-hour SMS failed:", err);
          await revertReminder(booking._id, "hour");
        }
      }
    }

    // ✅ 4. 15 minutes before
    const isFifteenBefore = timeDiffMs <= 15 * 60 * 1000 && timeDiffMs > 0;

    if (isFifteenBefore) {
      const claimed = await claimReminder(booking._id, "fifteen");
      if (claimed) {
        try {
          console.log(`⚠️ Sending 15-min reminder to ${leadPhone}`);
          await sendSMS(
            leadPhone,
            withStopFooter(`Just another heads up — your appointment is in 15 minutes. Talk soon!`),
            agentEmail,
            { source: "booking_reminder" }
          );
        } catch (err) {
          console.error("❌ 15-min SMS failed:", err);
          await revertReminder(booking._id, "fifteen");
        }
      }
    }
  }

  console.log("✅ All reminders processed");
}
