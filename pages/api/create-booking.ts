import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { getCalendarIdByEmail } from "@/lib/userHelpers";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Only POST allowed" });

  const { calendarOwnerEmail, name, email, phone, time } = req.body as {
    calendarOwnerEmail?: string;
    name?: string;
    email?: string;
    phone?: string;
    time?: string;
  };

  if (!calendarOwnerEmail || !name || !email || !time) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const calendarId = await getCalendarIdByEmail(calendarOwnerEmail);
  if (!calendarId) {
    return res.status(404).json({ message: "Calendar not found for this email" });
  }

  try {
    await dbConnect();

    await Lead.findOneAndUpdate(
      { email: email.toLowerCase() },
      { name, phone },
      { upsert: true, new: true }
    );

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });

    const calendar = google.calendar({ version: "v3", auth });

    const startISO = new Date(time).toISOString();
    const endISO = new Date(new Date(time).getTime() + 30 * 60000).toISOString();

    await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `Call with ${name}`,
        description: phone || "",
        start: { dateTime: startISO },
        end: { dateTime: endISO },
        attendees: [{ email }],
      },
    });

    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("create-booking error:", err);
    res.status(500).json({ message: "Booking failed" });
  }
}
