// /pages/api/calendar/watch.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import crypto from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
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
    return res.status(400).json({ message: "Missing Google tokens" });
  }

  const calendarId = user.calendarId || "primary";

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

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const channelId = `covecrm-${crypto.randomUUID()}`;
    const webhookUrl = `${process.env.NEXTAUTH_URL}/api/calendar/webhook`;

    const watchResponse = await calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId, // Unique ID for the channel
        type: "web_hook",
        address: webhookUrl,
      },
    });

    // Store watch info in DB (optional: for managing stop/renew logic later)
    await User.updateOne(
      { email: session.user.email },
      {
        $set: {
          googleWatch: {
            channelId,
            resourceId: watchResponse.data.resourceId,
            expiration: watchResponse.data.expiration || null,
          },
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Calendar watch started",
      channelId,
      resourceId: watchResponse.data.resourceId,
      expiration: watchResponse.data.expiration,
    });
  } catch (err: any) {
    console.error("❌ Failed to set up calendar watch:", err?.message || err);
    return res.status(500).json({ message: "Failed to start calendar watch" });
  }
}
