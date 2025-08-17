// /pages/api/availability.ts
import { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const { email, date } = req.body;
  if (!email || !date) return res.status(400).json({ message: "Missing required fields" });

  await dbConnect();
  const user = await User.findOne({ email });

  if (!user || !user.calendarId || !user.googleSheets || !user.bookingSettings) {
    return res.status(404).json({ message: "User not found or not properly connected" });
  }

  const {
    accessToken,
    refreshToken,
    expiryDate,
  } = user.googleSheets;

  const {
    workingHours,
    slotLength,
    bufferTime,
    timezone,
    maxPerDay
  } = user.bookingSettings;

  const calendar = google.calendar("v3");
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const targetDate = new Date(date);
  const weekday = targetDate.toLocaleDateString("en-US", { weekday: "short" });
  const daySchedule = workingHours[weekday];

  if (!daySchedule) return res.status(200).json({ slots: [] });

  const startOfDay = new Date(`${date}T${daySchedule.start}:00`);
  const endOfDay = new Date(`${date}T${daySchedule.end}:00`);

  try {
    const busy = await calendar.freebusy.query({
      auth,
      requestBody: {
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        timeZone: timezone,
        items: [{ id: user.calendarId }],
      },
    });

    const busyTimes = busy.data.calendars?.[user.calendarId]?.busy || [];

    const slots: string[] = [];
    let current = new Date(startOfDay);
    let bookedCount = 0;

    while (current < endOfDay) {
      const nextSlot = new Date(current.getTime() + slotLength * 60 * 1000);

      const overlap = busyTimes.some(b => {
        const bStart = new Date(b.start!);
        const bEnd = new Date(b.end!);
        return current < bEnd && nextSlot > bStart;
      });

      if (!overlap && bookedCount < maxPerDay) {
        slots.push(current.toISOString());
        bookedCount++;
      }

      current = new Date(current.getTime() + (slotLength + bufferTime) * 60 * 1000);
    }

    res.status(200).json({ slots });
  } catch (error) {
    console.error("Google API Error:", error);
    res.status(500).json({ message: "Error fetching availability" });
  }
}
