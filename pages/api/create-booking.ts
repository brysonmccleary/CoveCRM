import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { getCalendarIdByEmail } from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Only POST allowed" });

  const { calendarOwnerEmail, name, email, phone, time } = req.body;

  if (!calendarOwnerEmail || !name || !email || !time) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const calendarId = await getCalendarIdByEmail(calendarOwnerEmail);
  if (!calendarId) {
    return res.status(404).json({ message: "Calendar not found for this email" });
  }

  try {
    await dbConnect();

    const lead = await Lead.findOneAndUpdate(
      { email },
      { name, phone },
      { upsert: true, new: true }
    );

    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      undefined,
      (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/calendar"]
    );

    const calendar = google.calendar({ version: "v3", auth });

    await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `Call with ${name}`,
        description: phone || "",
        start: { dateTime: time },
        end: {
          dateTime: new Date(new Date(time).getTime() + 30 * 60000).toISOString(),
        },
        attendees: [{ email }],
      },
    });

    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("create-booking error:", err);
    res.status(500).json({ message: "Booking failed" });
  }
}
