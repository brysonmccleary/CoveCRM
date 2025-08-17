import { google } from "googleapis";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export async function getFreshGoogleOAuthClient(userEmail: string) {
  await dbConnect();

  const user = await User.findOne({ email: userEmail });
  const calendarData = user?.googleCalendar;

  if (!calendarData || !calendarData.refreshToken) {
    throw new Error("No Google Calendar credentials found");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  );

  oauth2Client.setCredentials({
    access_token: calendarData.accessToken,
    refresh_token: calendarData.refreshToken,
    expiry_date: calendarData.expiryDate,
  });

  // If expired or about to expire (less than 2 min buffer), refresh
  const isExpired = !calendarData.expiryDate || Date.now() >= calendarData.expiryDate - 120000;
  if (isExpired) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    await User.updateOne(
      { email: userEmail },
      {
        $set: {
          "googleCalendar.accessToken": credentials.access_token,
          "googleCalendar.expiryDate": credentials.expiry_date,
        },
      }
    );
  }

  return oauth2Client;
}
