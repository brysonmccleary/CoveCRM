import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getCalendarIdByEmail } from "@/lib/userHelpers";

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { email } = req.query;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ message: "Missing email" });
  }

  const calendarId = await getCalendarIdByEmail(email);
  if (!calendarId) {
    return res.status(404).json({ message: "No calendar linked to this email" });
  }

  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      scopes: SCOPES,
    });

    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Simulated top-of-hour slots (9–16) for the next 7 days
    const simulatedSlots: string[] = [];
    for (let i = 0; i < 7; i++) {
      const baseDay = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      for (let hour = 9; hour <= 16; hour++) {
        const slot = new Date(
          Date.UTC(
            baseDay.getUTCFullYear(),
            baseDay.getUTCMonth(),
            baseDay.getUTCDate(),
            hour, 0, 0, 0
          )
        );
        simulatedSlots.push(slot.toISOString());
      }
    }

    const events = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const busy = new Set(
      (events.data.items || [])
        .map((e) => (e.start?.dateTime ?? e.start?.date) || "")
        .filter(Boolean)
        .map((s) => new Date(s!).toISOString())
    );

    const available = simulatedSlots.filter((slot) => !busy.has(slot));
    res.status(200).json({ slots: available });
  } catch (err: any) {
    console.error("get-available-slots error:", err?.message || err);
    res.status(500).json({ message: "Failed to fetch slots" });
  }
}
