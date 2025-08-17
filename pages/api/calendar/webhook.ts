// /pages/api/calendar/webhook.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { Server as IOServer } from "socket.io";
import { Server as HTTPServer } from "http";

export const config = {
  api: {
    bodyParser: false,
  },
};

function extractPhone(text?: string): string | null {
  if (!text) return null;
  const match = text.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
  return match ? match[0].replace(/[^\d]/g, "") : null;
}

function parseNameFromSummary(summary: string): { firstName: string; lastName: string } {
  const nameParts = summary.trim().split(" ");
  const firstName = nameParts[0] || "Calendar";
  const lastName = nameParts.slice(1, 3).join(" ") || "Event";
  return { firstName, lastName };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse & { socket: { server: HTTPServer & { io?: IOServer } } }
) {
  if (req.method === "HEAD") {
    return res.status(200).end(); // Google webhook verification
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const resourceId = req.headers["x-goog-resource-id"] as string;
    const channelId = req.headers["x-goog-channel-id"] as string;

    if (!resourceId || !channelId) {
      return res.status(400).json({ message: "Missing Google headers" });
    }

    await dbConnect();

    const user = await User.findOne({ "googleWatch.resourceId": resourceId });
    if (!user) {
      console.warn("Webhook fired for unknown resourceId:", resourceId);
      return res.status(200).end();
    }

    const tokens =
      user.googleCalendar ||
      user.googleSheets ||
      user.googleTokens ||
      null;

    if (
      !tokens ||
      !tokens.accessToken ||
      !tokens.refreshToken ||
      !tokens.expiryDate
    ) {
      return res.status(400).json({ message: "Missing user tokens" });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      `${process.env.NEXTAUTH_URL}/api/google/callback`
    );

    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiryDate,
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const calendarId = user.calendarId || "primary";

    const now = new Date().toISOString();
    const response = await calendar.events.list({
      calendarId,
      timeMin: now,
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];
    console.log(`🔔 Webhook fired for ${user.email}: ${events.length} events`);

    for (const event of events) {
      try {
        if (!event.id || !event.start?.dateTime) continue;

        const summary = event.summary || "";
        const description = event.description || "";
        const email = event.attendees?.[0]?.email || event.creator?.email || "";
        const phone = extractPhone(summary) || extractPhone(description);
        const { firstName, lastName } = parseNameFromSummary(summary);

        const existingByEvent = await Lead.findOne({
          user: user._id,
          calendarEventId: event.id,
        });

        if (existingByEvent) {
          // Optional future: update appointmentTime if changed
          continue;
        }

        let existingByPhone = null;
        if (phone) {
          existingByPhone = await Lead.findOne({
            userEmail: user.email,
            Phone: phone,
          });
        }

        if (existingByPhone) {
          // Optional future: update appointmentTime
          console.log(`⚠️ Duplicate phone lead skipped: ${phone}`);
          continue;
        }

        const newLead = new Lead({
          user: user._id,
          userEmail: user.email,
          calendarEventId: event.id,
          appointmentTime: event.start.dateTime,
          source: "Google Calendar",
          Notes: (description || "") + "\n\n— Created via Google Calendar",
          Phone: phone,
          "First Name": firstName,
          "Last Name": lastName,
          Email: email,
          status: "New",
        });

        await newLead.save();
        console.log(`✅ Lead created from event: ${firstName} ${lastName}`);
      } catch (eventErr: any) {
        console.warn(`⚠️ Skipped problematic event:`, eventErr?.message || eventErr);
        continue;
      }
    }

    const io = res.socket.server.io;
    if (io && user._id) {
      io.to(`user-${user._id}`).emit("calendarUpdated", {
        source: "googleWebhook",
        events,
      });
    }

    return res.status(200).end();
  } catch (err: any) {
    console.error("❌ Error in calendar webhook:", err?.message || err);
    return res.status(500).json({ message: "Internal error" });
  }
}
