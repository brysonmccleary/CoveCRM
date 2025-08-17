import type { NextApiRequest, NextApiResponse } from "next";
import { getGoogleOAuthClient } from "@/lib/googleClient";
import dbConnect from "@/lib/mongodb";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import User from "@/models/User";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user?.email) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  const code = req.query.code as string;
  if (!code) {
    return res.status(400).json({ message: "Missing authorization code" });
  }

  await dbConnect();
  const client = getGoogleOAuthClient();

  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const calendar = google.calendar({ version: "v3", auth: client });
    const calendarList = await calendar.calendarList.list();
    const primaryCalendar = calendarList.data.items?.find((cal) => cal.primary);

    const decoded =
      tokens.id_token && tokens.id_token.split(".")[1]
        ? JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64").toString())
        : null;

    const googleEmail = decoded?.email || session.user.email;

    await User.findOneAndUpdate(
      { email: session.user.email },
      {
        $set: {
          googleSheets: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiryDate: tokens.expiry_date,
            googleEmail,
          },
          calendarId: primaryCalendar?.id || null,
        },
      },
      { new: true, upsert: false }
    );

    return res.redirect("/calendar");
  } catch (error) {
    console.error("❌ Google OAuth callback error:", error);
    return res.status(500).json({ message: "Google callback failed" });
  }
}
