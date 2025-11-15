import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { google } from "googleapis";

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

  // 🔐 IMPORTANT: always prefer dedicated calendar tokens, then legacy googleTokens.
  // Sheets-only tokens must NOT be used for Calendar (they may not have calendar scopes).
  const tokens: any =
    (user as any).googleCalendar ||
    (user as any).googleTokens ||
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
    return res.status(401).json({
      error: "Google not connected (no refresh token)",
      needsReconnect: true,
    });
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

    (user as any).flags = {
      ...(user as any).flags,
      calendarConnected: true,
      calendarNeedsReconnect: false,
    };
    await user.save();

    return res.status(200).json({ events });
  } catch (err: any) {
    const googlePayload = err?.response?.data;
    const msg = String(
      googlePayload?.error?.message || err?.message || err
    ).toLowerCase();
    const code = googlePayload?.error?.code || err?.code;

    // 🔒 If scopes are insufficient, mark as needing reconnect instead of generic 500.
    if (code === 403 || msg.includes("insufficient") && msg.includes("scope")) {
      console.error("❌ Google Calendar insufficient scopes:", googlePayload || err);

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
