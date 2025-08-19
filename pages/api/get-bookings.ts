// /pages/api/get-bookings.ts
import { google } from "googleapis";
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });

  if (!user?.calendarId || !user?.googleSheets?.accessToken) {
    return res.status(200).json({ events: [] }); // ✅ return empty list instead of 400
  }

  const { accessToken } = user.googleSheets;
  const calendarId = user.calendarId;

  const calendar = google.calendar("v3");
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    const events = await calendar.events.list({
      auth,
      calendarId,
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    });

    const upcoming =
      events.data.items?.map((event) => ({
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        attendees: event.attendees || [],
      })) || [];

    return res.status(200).json({ events: upcoming });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    return res.status(500).json({ message: "Failed to fetch bookings" });
  }
}
