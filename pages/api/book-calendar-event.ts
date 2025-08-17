import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { google } from "googleapis";
import { getUserByEmail } from "@/models/User";
import dbConnect from "@/lib/mongooseConnect";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { name, email, date, time } = req.body;
  if (!name || !email || !date || !time) {
    return res.status(400).json({ error: "Missing fields" });
  }

  await dbConnect();
  const user = await getUserByEmail(session.user?.email || "");
  if (!user?.accessToken || !user?.calendarId) {
    return res.status(400).json({ error: "Google Calendar not connected" });
  }

  const oAuth2Client = new google.auth.OAuth2();
  oAuth2Client.setCredentials({ access_token: user.accessToken });

  const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

  const startDateTime = new Date(`${date}T${time}:00`);
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60000); // 30-min event

  try {
    await calendar.events.insert({
      calendarId: user.calendarId,
      requestBody: {
        summary: `Meeting with ${name}`,
        description: `Email: ${email}`,
        start: { dateTime: startDateTime.toISOString() },
        end: { dateTime: endDateTime.toISOString() },
      },
    });

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("Calendar Error:", err.message);
    return res.status(500).json({ error: "Failed to book calendar event" });
  }
}
