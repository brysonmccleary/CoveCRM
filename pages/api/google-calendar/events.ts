// /pages/api/google-calendar/events.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Require a logged-in user
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  await dbConnect();

  const email = String(session.user.email).toLowerCase();
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: "User not found" });

  // Prefer googleTokens; fallback to googleSheets (older storage)
  const tokens: any =
    (user as any).googleTokens ||
    (user as any).googleSheets ||
    null;

  const calendarId = (user as any).calendarId || "primary";

  // We MUST have a refresh token for long-term access
  const refreshToken: string | undefined =
    tokens?.refreshToken || tokens?.refresh_token;

  if (!refreshToken) {
    // mark flags so UI can prompt reconnect
    (user as any).flags = {
      ...(user as any).flags,
      calendarConnected: false,
      calendarNeedsReconnect: true,
    };
    await user.save();
    return res.status(401).json({ error: "Google not connected (no refresh token)", needsReconnect: true });
  }

  // Build OAuth client (redirect URI not used here, but required for client config)
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  );
  // Only set the refresh_token; Google will mint access tokens as needed
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const now = new Date();
    const in7days = new Date(now.getTime());
    in7days.setDate(in7days.getDate() + 7);

    const response = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: in7days.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });

    const events =
      (response.data.items || []).map((event) => ({
        id: event.id,
        summary: event.summary || "",
        start: event.start?.dateTime || event.start?.date || "",
        end: event.end?.dateTime || event.end?.date || "",
        description: event.description || "",
        location: event.location || "",
        creator: event.creator?.email || "",
        colorId: event.colorId || null,
      })) || [];

    // mark healthy
    (user as any).flags = {
      ...(user as any).flags,
      calendarConnected: true,
      calendarNeedsReconnect: false,
    };
    await user.save();

    return res.status(200).json({ events });
  } catch (error: any) {
    const msg = String(error?.message || error);

    // If Google says the refresh token is bad/revoked, prompt reconnect
    if (msg.includes("invalid_grant")) {
      (user as any).flags = {
        ...(user as any).flags,
        calendarConnected: false,
        calendarNeedsReconnect: true,
      };
      await user.save();
      return res.status(401).json({ error: "invalid_grant", needsReconnect: true });
    }

    console.error("❌ Error fetching Google Calendar events:", error?.response?.data || msg);
    return res.status(500).json({ error: "Failed to fetch calendar events" });
  }
}
