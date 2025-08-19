// /pages/api/calendar/update-event.ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import { getToken } from "next-auth/jwt";
import Lead from "@/models/Lead";
import User from "@/models/User";
import { google } from "googleapis";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const token = await getToken({ req });
  if (!token?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  const { leadId, newStartTime, newEndTime, updatedSummary } = req.body;

  if (!leadId || !newStartTime || !newEndTime) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const lead = await Lead.findById(leadId);
    if (!lead || !lead.calendarEventId) {
      return res
        .status(404)
        .json({ message: "Lead or calendarEventId not found" });
    }

    const user = await User.findOne({ email: lead.userEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const tokens =
      user.googleCalendar || user.googleSheets || user.googleTokens || null;

    if (
      !tokens ||
      !tokens.accessToken ||
      !tokens.refreshToken ||
      !tokens.expiryDate
    ) {
      return res.status(400).json({ message: "Missing user Google tokens" });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      `${process.env.NEXTAUTH_URL}/api/google/callback`,
    );

    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiryDate,
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const calendarId = user.calendarId || "primary";

    const updatedEvent = await calendar.events.patch({
      calendarId,
      eventId: lead.calendarEventId,
      requestBody: {
        start: { dateTime: newStartTime },
        end: { dateTime: newEndTime },
        summary: updatedSummary || `${lead["First Name"]} ${lead["Last Name"]}`,
        description: lead.Notes || "",
      },
    });

    return res
      .status(200)
      .json({ message: "Event updated", event: updatedEvent.data });
  } catch (err: any) {
    console.error("❌ Error updating calendar event:", err);
    return res.status(500).json({ message: "Error updating event" });
  }
}
