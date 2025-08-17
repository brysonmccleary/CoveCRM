// /pages/api/calendar/events.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

/**
 * GET /api/calendar/events?start=ISO&end=ISO
 * Uses the signed-in user's Google refresh token to fetch events
 * from user.calendarId || "primary" within [start, end].
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Not authenticated" });

  const { start, end } = req.query as { start?: string; end?: string };
  if (!start || !end) return res.status(400).json({ error: "Missing start/end ISO params" });

  // Basic ISO validation
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return res.status(400).json({ error: "Invalid start/end" });
  }

  await dbConnect();
  const email = String(session.user.email).toLowerCase();
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: "User not found" });

  // Support legacy storage locations for tokens
  const tokens: any =
    (user as any).googleTokens ||
    (user as any).googleCalendar || // some apps store refresh here
    (user as any).googleSheets ||
    null;

  const refreshToken: string | undefined =
    tokens?.refreshToken || tokens?.refresh_token;

  if (!refreshToken) {
    (user as any).flags = {
      ...(user as any).flags,
      calendarConnected: false,
      calendarNeedsReconnect: true,
    };
    await user.save();
    return res.status(401).json({ error: "Google not connected (no refresh token)", needsReconnect: true });
  }

  const calendarId = (user as any).calendarId || "primary";

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const response = await calendar.events.list({
      calendarId,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250, // safe upper bound
    });

    const events =
      (response.data.items || []).map((event) => ({
        id: event.id || "",
        summary: event.summary || "",
        start: event.start?.dateTime || event.start?.date || "",
        end: event.end?.dateTime || event.end?.date || "",
        description: event.description || "",
        location: event.location || "",
        colorId: event.colorId || null,
        attendees: (event.attendees || []).map((a) => a.email || "").filter(Boolean),
      })) || [];

    (user as any).flags = {
      ...(user as any).flags,
      calendarConnected: true,
      calendarNeedsReconnect: false,
    };
    await user.save();

    return res.status(200).json({ events });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes("invalid_grant")) {
      (user as any).flags = {
        ...(user as any).flags,
        calendarConnected: false,
        calendarNeedsReconnect: true,
      };
      await user.save();
      return res.status(401).json({ error: "invalid_grant", needsReconnect: true });
    }

    console.error("❌ Google Calendar events error:", err?.response?.data || msg);
    return res.status(500).json({ error: "Failed to fetch events" });
  }
}
