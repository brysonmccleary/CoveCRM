import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";
import axios from "axios";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const user = await getUserByEmail(session.user.email);
    if (!user?.googleCalendar?.accessToken) {
      return res.status(400).json({ error: "No Google Calendar access token found" });
    }

    const accessToken = user.googleCalendar.accessToken;
    const calendarId = user.calendarId || "primary";

    // Fetch next 10 upcoming events
    const now = new Date().toISOString();
    const googleRes = await axios.get(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          timeMin: now,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 10,
        },
      }
    );

    const events = googleRes.data.items || [];
    return res.status(200).json(events);
  } catch (err: any) {
    console.error("❌ Error fetching calendar events:", err?.response?.data || err.message);
    return res.status(500).json({ error: "Failed to fetch calendar events" });
  }
}
