import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { google } from "googleapis";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "dev-mobile-secret";

function getEmailFromAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const emailRaw = (
      payload?.email ||
      payload?.userEmail ||
      payload?.sub ||
      ""
    ).toString();
    const email = emailRaw.trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const userEmail = getEmailFromAuth(req);
  if (!userEmail) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    await mongooseConnect();

    const user = await User.findOne({ email: userEmail })
      .select({ calendarId: 1, googleSheets: 1 })
      .lean();

    const calendarId = (user as any)?.calendarId;
    const accessToken = (user as any)?.googleSheets?.accessToken;
    if (!calendarId || !accessToken) {
      return res.status(200).json({ ok: true, events: [] });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const calendar = google.calendar("v3");
    const events = await calendar.events.list({
      auth,
      calendarId,
      timeMin: new Date().toISOString(),
      maxResults: 20,
      singleEvents: true,
      orderBy: "startTime",
    });

    const mapped =
      events.data.items?.map((event) => ({
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        attendees: event.attendees || [],
      })) || [];

    return res.status(200).json({ ok: true, events: mapped });
  } catch (error) {
    console.error("mobile/bookings error:", error);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
