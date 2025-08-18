import { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { Twilio } from "twilio";

const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const { email, slot, name, guestEmail, phone } = req.body;

  if (!email || !slot || !name || !guestEmail) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  await dbConnect();
  const user = await User.findOne({ email });

  if (!user || !user.calendarId || !user.googleSheets) {
    return res.status(404).json({ message: "User not properly connected" });
  }

  const { accessToken, refreshToken, googleEmail } = user.googleSheets;

  const calendar = google.calendar("v3");
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const start = new Date(slot);
  const end = new Date(
    start.getTime() + user.bookingSettings.slotLength * 60000,
  );

  try {
    const event = await calendar.events.insert({
      auth,
      calendarId: user.calendarId,
      requestBody: {
        summary: `Meeting with ${name}`,
        description: `Booked via CRM Cove`, // ✅ UPDATED NAME
        start: {
          dateTime: start.toISOString(),
          timeZone: user.bookingSettings.timezone,
        },
        end: {
          dateTime: end.toISOString(),
          timeZone: user.bookingSettings.timezone,
        },
        attendees: [{ email: guestEmail }],
        reminders: {
          useDefault: true,
        },
      },
    });

    // Optional: send SMS confirmation to guest
    if (phone) {
      await twilioClient.messages.create({
        to: phone,
        from: process.env.TWILIO_PHONE_NUMBER!,
        body: `Your meeting with ${googleEmail} is confirmed for ${start.toLocaleString()}`,
      });
    }

    res
      .status(200)
      .json({ message: "Booking confirmed", eventId: event.data.id });
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({ message: "Failed to create calendar event" });
  }
}
