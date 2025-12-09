// pages/api/ai-calls/book-appointment.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/dbConnect";
import AICallSession from "@/models/AICallSession";
import Lead from "@/models/Lead";
import User from "@/models/User";
import { google } from "googleapis";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

type BookAppointmentRequest = {
  aiCallSessionId: string;
  leadId: string;
  startTimeUtc: string; // ISO string in UTC
  durationMinutes: number;
  leadTimeZone: string;  // e.g. "America/Chicago"
  agentTimeZone: string; // e.g. "America/Phoenix"
  notes?: string;
  source?: string;       // e.g. "ai-dialer"
};

type BookAppointmentResponse = {
  ok: boolean;
  error?: string;
  eventId?: string;
  calendarId?: string;
  startTimeAgentTz?: string;
  startTimeLeadTz?: string;
  humanReadableForLead?: string;
  hangoutLink?: string | null;
  rawEvent?: any;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BookAppointmentResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // ─────────────────────── Auth via secret key ───────────────────────
    const key = (req.query.key as string) || (req.headers["x-ai-dialer-key"] as string);
    if (!AI_DIALER_CRON_KEY || key !== AI_DIALER_CRON_KEY) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const {
      aiCallSessionId,
      leadId,
      startTimeUtc,
      durationMinutes,
      leadTimeZone,
      agentTimeZone,
      notes,
      source,
    } = req.body as BookAppointmentRequest;

    if (
      !aiCallSessionId ||
      !leadId ||
      !startTimeUtc ||
      !durationMinutes ||
      !leadTimeZone ||
      !agentTimeZone
    ) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields in request body",
      });
    }

    const startUtcDate = new Date(startTimeUtc);
    if (Number.isNaN(startUtcDate.getTime())) {
      return res.status(400).json({
        ok: false,
        error: "Invalid startTimeUtc",
      });
    }

    await dbConnect();

    // ─────────────────────── Multi-tenant safety ───────────────────────
    const session = await AICallSession.findById(aiCallSessionId);
    if (!session) {
      return res.status(404).json({ ok: false, error: "AI call session not found" });
    }

    const userEmail: string | undefined = session.userEmail;
    if (!userEmail) {
      return res
        .status(500)
        .json({ ok: false, error: "AI call session missing userEmail" });
    }

    const lead = await Lead.findOne({
      _id: leadId,
      $or: [{ userEmail }, { ownerEmail: userEmail }, { user: userEmail }],
    });

    if (!lead) {
      return res.status(404).json({
        ok: false,
        error: "Lead not found for this user",
      });
    }

    const user: any = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const refreshToken =
      user?.googleTokens?.refreshToken ||
      user?.googleTokens?.refresh_token ||
      user?.googleSheets?.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({
        ok: false,
        error: "Google Calendar not connected for this user",
      });
    }

    // ─────────────────────── Google Calendar client ───────────────────────
    const oauth2 = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
    oauth2.setCredentials({
      refresh_token: refreshToken,
      access_token: user?.googleTokens?.access_token,
      expiry_date: user?.googleTokens?.expiry_date,
    });
    const calendar = google.calendar({ version: "v3", auth: oauth2 });

    // Agent timezone preference
    const agentTz: string =
      user?.bookingSettings?.timezone || agentTimeZone || "America/Los_Angeles";

    const endUtcDate = new Date(
      startUtcDate.getTime() + durationMinutes * 60 * 1000
    );

    // ─────────────────────── Normalize lead data ───────────────────────
    const firstName =
      lead.firstName || lead["First Name"] || (lead as any).First || "";
    const lastName =
      lead.lastName || lead["Last Name"] || (lead as any).Last || "";
    const leadEmail = lead.email || lead.Email || "";
    const phoneRaw = lead.phone || lead.Phone || "";

    const displayLeadName =
      [firstName, lastName].filter(Boolean).join(" ") || "Lead";

    const agentName =
      user?.name ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      String(userEmail).split("@")[0];

    const summary = `Call with ${displayLeadName}`;
    const descLines = [
      phoneRaw ? `Phone: ${phoneRaw}` : "",
      leadEmail ? `Email: ${leadEmail}` : "",
      `Agent: ${agentName}`,
      source ? `Source: ${source}` : "",
      notes ? `Notes: ${notes}` : "",
      "Booked via CoveCRM AI Dialer",
    ].filter(Boolean);
    const description = descLines.join("\n");

    const attendees = leadEmail ? [{ email: leadEmail }] : undefined;

    const calendarId = user?.calendarId || "primary";

    // Event is stored in agent timezone; AI brain handles parsing / UTC conversion.
    const event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary,
        description,
        start: {
          dateTime: startUtcDate.toISOString(),
          timeZone: agentTz,
        },
        end: {
          dateTime: endUtcDate.toISOString(),
          timeZone: agentTz,
        },
        attendees: attendees as any,
        reminders: { useDefault: true },
      },
      sendUpdates: attendees ? "all" : "none",
    });

    const eventData = event.data;

    // ─────────────────────── Timezone formatting for AI voice ───────────────────────
    const startTimeAgentTz = convertUtcToTimeZone(startUtcDate, agentTz);
    const startTimeLeadTz = convertUtcToTimeZone(startUtcDate, leadTimeZone);
    const humanReadableForLead = formatHumanReadableForZone(
      startUtcDate,
      leadTimeZone
    );

    return res.status(200).json({
      ok: true,
      eventId: eventData.id || undefined,
      calendarId,
      startTimeAgentTz,
      startTimeLeadTz,
      humanReadableForLead,
      hangoutLink: eventData.hangoutLink || null,
      rawEvent: eventData,
    });
  } catch (err: any) {
    console.error("[AI-CALLS][BOOK-APPOINTMENT] Error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Internal server error",
    });
  }
}

/**
 * Convert a UTC Date to an ISO-like string in a specific IANA timezone.
 * This is primarily for display / logging.
 */
function convertUtcToTimeZone(dateUtc: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(dateUtc)
      .reduce<Record<string, string>>((acc, part) => {
        if (part.type !== "literal") acc[part.type] = part.value;
        return acc;
      }, {});

    const year = parts.year;
    const month = parts.month;
    const day = parts.day;
    const hour = parts.hour;
    const minute = parts.minute;
    const second = parts.second;

    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  } catch {
    return dateUtc.toISOString();
  }
}

/**
 * Human-readable string for the lead to hear:
 * e.g. "Thursday, Dec 11 at 4:00 PM your time"
 */
function formatHumanReadableForZone(dateUtc: Date, timeZone: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(dateUtc) + " your time"
    );
  } catch {
    return dateUtc.toISOString() + " (UTC)";
  }
}
