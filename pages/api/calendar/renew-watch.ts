// /pages/api/calendar/renew-watch.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import crypto from "crypto";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await dbConnect();

    const users = await User.find({
      "googleWatch.expiration": { $exists: true },
    });

    const now = Date.now();
    const renewedUsers: string[] = [];

    for (const user of users) {
      const expires = parseInt(user.googleWatch?.expiration || "0", 10);
      if (!expires || now < expires - 60 * 1000) continue; // skip if not close to expiring

      const tokens =
        user.googleTokens || user.googleCalendar || user.googleSheets;
      if (!tokens) continue;

      const calendarId = user.calendarId || "primary";

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

      const channelId = `covecrm-${crypto.randomUUID()}`;
      const webhookUrl = `${process.env.NEXTAUTH_URL}/api/calendar/webhook`;

      const watchResponse = await calendar.events.watch({
        calendarId,
        requestBody: {
          id: channelId,
          type: "web_hook",
          address: webhookUrl,
        },
      });

      await User.updateOne(
        { email: user.email },
        {
          $set: {
            googleWatch: {
              channelId,
              resourceId: watchResponse.data.resourceId,
              expiration: watchResponse.data.expiration,
            },
          },
        },
      );

      renewedUsers.push(user.email);
    }

    return res.status(200).json({
      success: true,
      renewed: renewedUsers,
    });
  } catch (err: any) {
    console.error("❌ Error in renew-watch:", err?.message || err);
    return res.status(500).json({ message: "Failed to renew watch channels" });
  }
}
