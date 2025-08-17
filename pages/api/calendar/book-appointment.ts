// /pages/api/calendar/book-appointment.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
// NOTE: path must be correct relative to THIS file:
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/folder";
import Message from "@/models/Message";
import { google } from "googleapis";
import twilioClient from "@/lib/twilioClient";
import { getTimezoneFromState } from "@/utils/timezone";
import { DateTime } from "luxon";

// NEW: email utilities
import { sendEmail, renderLeadBookingEmail, renderAgentBookingEmail } from "@/lib/email";

type Body = {
  leadId: string;
  title?: string;
  startISO: string; // ISO datetime (may include offset)
  endISO: string;   // ISO datetime (may include offset)
  description?: string;
};

function normalizeUSPhone(raw: string): string {
  const s = (raw || "").replace(/[^\d+]/g, "");
  if (s.startsWith("+")) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return raw;
}
function withStopFooter(s: string) {
  return /reply stop to opt out/i.test(s) ? s : `${s} Reply STOP to opt out.`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email;
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, title, startISO, endISO, description } = (req.body || {}) as Body;
  if (!leadId || !startISO || !endISO) {
    return res.status(400).json({ message: "Missing required fields (leadId, startISO, endISO)" });
  }

  try {
    await dbConnect();

    // Load agent + ensure Calendar tokens exist
    const user: any = await User.findOne({ email: userEmail });
    const refreshToken =
      user?.googleTokens?.refreshToken ||
      user?.googleTokens?.refresh_token ||
      user?.googleSheets?.refreshToken;
    if (!refreshToken) {
      return res.status(400).json({ message: "Google Calendar not connected for this user" });
    }

    // Agent display name
    const agentName =
      user?.name ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      String(userEmail).split("@")[0];

    // OAuth + Calendar client
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2.setCredentials({
      refresh_token: refreshToken,
      access_token: user?.googleTokens?.access_token,
      expiry_date: user?.googleTokens?.expiry_date,
    });
    const calendar = google.calendar({ version: "v3", auth: oauth2 });

    // Agent timezone: prefer saved setting; else read from Google Calendar; fallback LA
    let agentTz: string = user?.bookingSettings?.timezone || "";
    if (!agentTz) {
      try {
        const cal = await calendar.calendars.get({ calendarId: user?.calendarId || "primary" });
        agentTz = cal.data.timeZone || "";
      } catch {
        // ignore
      }
    }
    if (!agentTz) agentTz = "America/Los_Angeles";

    // Load lead (user-scoped)
    const lead: any = await Lead.findOne({ _id: leadId, userEmail });
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    // Normalize lead fields
    const firstName = lead.firstName || lead["First Name"] || lead.First || "";
    const lastName  = lead.lastName  || lead["Last Name"]  || lead.Last  || "";
    const leadPhone = normalizeUSPhone(lead.phone || lead.Phone || "");
    const leadEmail = lead.email || lead.Email || "";
    const state     = lead.state || lead.State || "";

    // Prefer client-provided header tz if present; else state→TZ; else ET
    const headerTz = (req.headers["x-app-tz"] as string) || "";
    const clientTz = headerTz || getTimezoneFromState(state || "") || "America/New_York";

    // Parse provided datetimes, preserving any included offset; then convert to desired zones
    const startParsed = DateTime.fromISO(startISO, { setZone: true });
    const endParsed   = DateTime.fromISO(endISO,   { setZone: true });
    if (!startParsed.isValid || !endParsed.isValid) {
      return res.status(400).json({ message: "Invalid startISO/endISO" });
    }
    const startAgent  = startParsed.setZone(agentTz);
    const endAgent    = endParsed.setZone(agentTz);
    const startClient = startParsed.setZone(clientTz);

    // Build event payload — book in AGENT timezone
    const summary =
      title || `Call with ${[firstName, lastName].filter(Boolean).join(" ") || "Lead"}`;
    const desc =
      (description && description.trim()) ||
      [
        leadPhone ? `Phone: ${leadPhone}` : "",
        leadEmail ? `Email: ${leadEmail}` : "",
        "Booked via CoveCRM",
      ]
        .filter(Boolean)
        .join("\n");
    const attendees = leadEmail ? [{ email: leadEmail }] : undefined;

    const event = await calendar.events.insert({
      calendarId: user?.calendarId || "primary",
      requestBody: {
        summary,
        description: desc,
        start: { dateTime: startAgent.toISO(), timeZone: agentTz },
        end:   { dateTime: endAgent.toISO(),   timeZone: agentTz },
        attendees,
        reminders: { useDefault: true },
      },
      sendUpdates: attendees ? "all" : "none",
    });

    const eventId = event.data.id || "";
    const eventUrl =
      event.data.htmlLink ||
      (eventId ? `https://calendar.google.com/calendar/u/0/r/eventedit/${eventId}` : undefined);

    // SMS confirmation — show CLIENT timezone + agent NAME
    try {
      const numbers: Array<{ phoneNumber?: string; messagingServiceSid?: string }> = Array.isArray(user?.numbers)
        ? user.numbers
        : [];
      const msSid = numbers.find((n) => n.messagingServiceSid)?.messagingServiceSid;
      const fromNumber = numbers.find((n) => n.phoneNumber)?.phoneNumber || process.env.TWILIO_CALLER_ID;

      if (leadPhone) {
        const tzShort = (startClient as any).offsetNameShort || startClient.toFormat("ZZZZ");
        const whenStr = `${startClient.toFormat("ccc, MMM d 'at' h:mm a")} ${tzShort}`;
        const body = withStopFooter(
          `You're booked with ${agentName} on ${whenStr}. If you need to reschedule, reply here.`
        );

        if (msSid) {
          await twilioClient.messages.create({ to: leadPhone, body, messagingServiceSid: msSid });
        } else if (fromNumber) {
          await twilioClient.messages.create({ to: leadPhone, body, from: fromNumber });
        }
      }
    } catch (e) {
      console.warn("SMS confirmation failed:", e);
    }

    // EMAIL confirmations (best-effort; failures do not break booking)
    try {
      // Lead email (if present)
      if (leadEmail) {
        const html = renderLeadBookingEmail({
          leadName: [firstName, lastName].filter(Boolean).join(" ") || undefined,
          agentName,
          startISO: startAgent.toISO(),
          endISO: endAgent.toISO(),
          title: summary,
          description: desc,
          eventUrl,
        });
        await sendEmail(leadEmail, "Your appointment is confirmed", html);
      }

      // Agent email (always to the signed-in user)
      {
        const leadUrl = `${process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || ""}/lead/${lead._id}`;
        const html = renderAgentBookingEmail({
          agentName,
          leadName: [firstName, lastName].filter(Boolean).join(" ") || undefined,
          leadPhone,
          leadEmail,
          startISO: startAgent.toISO(),
          endISO: endAgent.toISO(),
          title: summary,
          description: desc,
          leadUrl,
          eventUrl,
        });
        await sendEmail(userEmail, "New booking scheduled", html);
      }
    } catch (e) {
      console.warn("Email confirmations failed:", e);
    }

    // Move to "Booked Appointment" + set status
    let folder = await Folder.findOne({ userEmail, name: "Booked Appointment" });
    if (!folder) folder = await Folder.create({ userEmail, name: "Booked Appointment" });

    lead.folderId = folder._id;
    lead.status = "Booked Appointment";
    await lead.save();

    // Timeline note (records agent-local time)
    try {
      await Message.create({
        leadId: lead._id,
        userEmail,
        direction: "ai",
        text: `📅 Appointment booked for ${startAgent.toFormat("ccc, MMM d 'at' h:mm a")} (${agentTz}).`,
        read: true,
        sentAt: new Date(),
      });
    } catch {}

    // Optional socket notifications
    try {
      const io = (res.socket as any)?.server?.io;
      if (io) {
        io.to(userEmail).emit("calendarUpdated", { eventId });
        io.to(`user-${userEmail}`).emit("calendarUpdated", { eventId });
      }
    } catch {}

    return res.status(200).json({ success: true, eventId, eventUrl });
  } catch (err: any) {
    console.error("book-appointment error:", err?.response?.data || err?.message || err);
    return res.status(500).json({ message: "Internal server error" });
  }
}
