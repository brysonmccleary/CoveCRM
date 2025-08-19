// /pages/api/calendar/check-conflict.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

function getBaseUrl(req: NextApiRequest) {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    req.headers.host ||
    "localhost:3000";
  return `${proto}://${host}`.replace(/\/$/, "");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { agentEmail, time, durationMinutes } = req.body || {};
  if (!agentEmail || !time) {
    return res
      .status(400)
      .json({ message: "Missing agentEmail or time" });
  }

  // Window to check (default 30 minutes)
  const start = new Date(time);
  const end = new Date(
    start.getTime() + (Number(durationMinutes) > 0 ? Number(durationMinutes) : 30) * 60 * 1000,
  );

  await dbConnect();

  const user = await User.findOne({ email: String(agentEmail).toLowerCase() });
  if (!user) {
    return res.status(404).json({ message: "Agent not found" });
  }

  // ---- OAuth client (same pattern as create-event)
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    getBaseUrl(req);

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI_CALENDAR ||
    `${base.replace(/\/$/, "")}/api/connect/google-calendar/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri,
  );

  // Prefer calendar tokens; fall back to Sheets store if present
  const tokenStore: any =
    (user as any).googleTokens ||
    (user as any).googleSheets ||
    null;

  const accessToken = tokenStore?.accessToken || undefined;
  const refreshToken = tokenStore?.refreshToken || undefined;
  const expiryDate =
    tokenStore?.expiryDate ?? tokenStore?.expiry_date ?? undefined;

  if (!refreshToken) {
    return res.status(400).json({
      message: "Calendar not connected. Please connect Google Calendar.",
      reconnect: "/api/connect/google-calendar",
    });
  }

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiryDate,
  });

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: (user as any).calendarId || "primary" }],
      },
    });

    const calId = (user as any).calendarId || "primary";
    const busy =
      fb.data.calendars?.[calId]?.busy ||
      fb.data.calendars?.primary?.busy ||
      [];

    const hasConflict = Array.isArray(busy) && busy.length > 0;

    return res.status(200).json({
      conflict: hasConflict,
      busy,
      message: hasConflict ? "Time is already booked." : "Booking allowed.",
    });
  } catch (err: any) {
    console.error("freebusy.query failed:", err?.response?.data || err?.message || err);
    return res.status(500).json({
      message: "Failed to check conflicts",
      error: err?.message || "unknown",
    });
  }
}
