import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user || !user.googleTokens?.accessToken || !user.calendarId) {
    return res.status(400).json({ message: "Missing Google calendar credentials" });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${process.env.NEXTAUTH_URL}/api/google/callback`
  );

  oauth2Client.setCredentials({
    access_token: user.googleTokens.accessToken,
    refresh_token: user.googleTokens.refreshToken,
    expiry_date: user.googleTokens.expiryDate,
  });

  // 🔁 Refresh access token if expired
  try {
    const { token, res: tokenRes } = await oauth2Client.getAccessToken();
    if (token && tokenRes?.data?.expiry_date) {
      oauth2Client.setCredentials({
        access_token: token,
        expiry_date: tokenRes.data.expiry_date,
        refresh_token: user.googleTokens.refreshToken,
      });

      user.googleTokens.accessToken = token;
      user.googleTokens.expiryDate = tokenRes.data.expiry_date;
      await user.save();
    }
  } catch (err) {
    console.error("❌ Failed to refresh token:", err);
    return res.status(401).json({ message: "Failed to refresh token" });
  }

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const now = new Date().toISOString();
    const oneWeekLater = new Date();
    oneWeekLater.setDate(oneWeekLater.getDate() + 7);

    const response = await calendar.events.list({
      calendarId: user.calendarId,
      timeMin: now,
      timeMax: oneWeekLater.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });

    const events = response.data.items || [];

    const formatted = events.map((event) => ({
      id: event.id,
      summary: event.summary || "No title",
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      creator: event.creator?.email,
      location: event.location || null,
      description: event.description || null,
    }));

    return res.status(200).json({ events: formatted });
  } catch (err) {
    console.error("❌ Failed to fetch calendar events:", err);
    return res.status(500).json({ message: "Failed to fetch events" });
  }
}
