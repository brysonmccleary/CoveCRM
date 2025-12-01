// /pages/api/calendar/events.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { google } from "googleapis";
import { getFreshGoogleOAuthClient } from "@/lib/googleCalendarClient";

/** Bare "Call with" detector (allows optional phone emoji) */
function isBareCallWith(s?: string) {
  const t = (s || "").trim();
  return (
    /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})?\s*call with\s*$/iu.test(
      t
    ) || t === ""
  );
}

/**
 * GET /api/calendar/events?start=ISO&end=ISO
 * Uses the signed-in user's Google refresh token to fetch events
 * from user.calendarId || "primary" within [start, end].
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ error: "Not authenticated" });

  const { start, end } = req.query as { start?: string; end?: string };
  if (!start || !end)
    return res.status(400).json({ error: "Missing start/end ISO params" });

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return res.status(400).json({ error: "Invalid start/end" });
  }

  await dbConnect();
  const email = String(session.user.email).toLowerCase();
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const calendarId = (user as any).calendarId || "primary";

  try {
    // Centralized token handling + invalid_grant logic
    const oauth2Client = await getFreshGoogleOAuthClient(email);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const response = await calendar.events.list({
      calendarId,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    // Raw events from Google
    const raw = (response.data.items || []).map((event) => ({
      id: event.id || "",
      summary: event.summary || "",
      start: event.start?.dateTime || event.start?.date || "",
      end: event.end?.dateTime || event.end?.date || "",
      description: event.description || "",
      location: event.location || "",
      colorId: event.colorId || null,
      attendees: (event.attendees || [])
        .map((a) => a.email || "")
        .filter(Boolean),
    }));

    // ---- Enrich weak titles ("Call with") from our CRM leads by eventId
    const needsNameIds = raw
      .filter((e) => isBareCallWith(e.summary))
      .map((e) => e.id);
    let nameByEventId: Record<string, string> = {};
    if (needsNameIds.length > 0) {
      const leads = await Lead.find(
        { userEmail: email, calendarEventId: { $in: needsNameIds } },
        {
          "First Name": 1,
          firstName: 1,
          "Last Name": 1,
          lastName: 1,
          calendarEventId: 1,
        }
      ).lean();

      for (const l of leads) {
        const first = (
          l["First Name"] ||
          (l as any).firstName ||
          ""
        )
          .toString()
          .trim();
        const last = (
          l["Last Name"] ||
          (l as any).lastName ||
          ""
        )
          .toString()
          .trim();
        const full = `${first} ${last}`.trim() || "Lead";
        if ((l as any).calendarEventId) {
          nameByEventId[(l as any).calendarEventId] = full;
        }
      }
    }

    const events = raw.map((e) => {
      let summary = e.summary || "";
      if (isBareCallWith(summary)) {
        const full = nameByEventId[e.id];
        if (full) summary = `Call with ${full}`;
      }
      return { ...e, summary };
    });

    // Mark user as connected & healthy
    (user as any).flags = {
      ...(user as any).flags,
      calendarConnected: true,
      calendarNeedsReconnect: false,
    };
    await user.save();

    return res.status(200).json({ events });
  } catch (err: any) {
    const msg = String(
      err?.message ||
        err?.response?.data?.error_description ||
        err?.response?.data?.error ||
        err
    ).toLowerCase();
    const googlePayload = err?.response?.data;
    const code = googlePayload?.error?.code || err?.code;

    // Tokens missing or removed
    if (msg.includes("no google calendar credentials found")) {
      (user as any).flags = {
        ...(user as any).flags,
        calendarConnected: false,
        calendarNeedsReconnect: true,
      };
      await user.save();
      return res.status(401).json({
        error: "no_credentials",
        needsReconnect: true,
      });
    }

    // Our helper cleared tokens and wants a reconnect
    if (
      err?.code === "GOOGLE_RECONNECT_REQUIRED" ||
      err?.message === "GOOGLE_RECONNECT_REQUIRED"
    ) {
      (user as any).flags = {
        ...(user as any).flags,
        calendarConnected: false,
        calendarNeedsReconnect: true,
      };
      await user.save();
      return res.status(401).json({
        error: "GOOGLE_RECONNECT_REQUIRED",
        needsReconnect: true,
      });
    }

    // Insufficient scopes – also treat as reconnect
    if (code === 403 || (msg.includes("insufficient") && msg.includes("scope"))) {
      console.error(
        "❌ Google Calendar insufficient scopes:",
        googlePayload || err
      );

      (user as any).flags = {
        ...(user as any).flags,
        calendarConnected: false,
        calendarNeedsReconnect: true,
      };
      await user.save();

      return res.status(401).json({
        error: "insufficient_scopes",
        needsReconnect: true,
      });
    }

    // Fallback invalid_grant handling (should be rare if helper caught it)
    if (msg.includes("invalid_grant")) {
      (user as any).flags = {
        ...(user as any).flags,
        calendarConnected: false,
        calendarNeedsReconnect: true,
      };
      await user.save();
      return res
        .status(401)
        .json({ error: "invalid_grant", needsReconnect: true });
    }

    console.error(
      "❌ Google Calendar events error:",
      googlePayload || err?.message || err
    );
    return res.status(500).json({ error: "Failed to fetch events" });
  }
}
