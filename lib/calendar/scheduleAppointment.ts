// lib/calendar/scheduleAppointment.ts
// Core "book a new appointment" logic, extracted from
// pages/api/calendar/book-appointment.ts so it can be reused by the
// assistant's schedule_appointment tool without an internal self-HTTP call.
// Behavior is unchanged from the original handler, with one deliberate
// omission: the original route's best-effort Socket.IO "calendarUpdated"
// push (tied to the HTTP response's underlying socket) is not replicated
// here — the booking itself, the calendar event, the confirmation SMS/email,
// and the folder/status move all still happen identically either way; only
// the live in-app UI refresh ping is route-specific and stays there.

import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import Message from "@/models/Message";
import { google } from "googleapis";
import { getTimezoneFromState } from "@/utils/timezone";
import { DateTime } from "luxon";
import { recordLeadOutcome } from "@/lib/analytics/recordLeadOutcome";
import { sendSms } from "@/lib/twilio/sendSMS";
import { withStopFooter } from "@/lib/sms/complianceFooter";
import { sendEmail, renderAgentBookingEmail } from "@/lib/email";

function normalizeUSPhone(raw: string): string {
  const s = (raw || "").replace(/[^\d+]/g, "");
  if (s.startsWith("+")) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return raw;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeLeadEmailForConfirmation(args: {
  attemptedEmail: any;
  leadId?: any;
  ownerEmail?: string;
  userEmail?: string;
}): string {
  const attemptedEmail = String(args.attemptedEmail || "").trim();
  const ownerEmail = String(args.ownerEmail || args.userEmail || "").trim().toLowerCase();
  const normalized = attemptedEmail.toLowerCase();
  if (attemptedEmail && EMAIL_RE.test(attemptedEmail) && normalized !== ownerEmail) {
    return attemptedEmail;
  }
  console.warn("[CONFIRMATION_EMAIL_BLOCKED_INVALID_LEAD_EMAIL]", {
    leadId: args.leadId ? String(args.leadId) : "",
    attemptedEmail,
    ownerEmail: args.ownerEmail || "",
    userEmail: args.userEmail || "",
  });
  return "";
}

export type ScheduleAppointmentResult =
  | { ok: true; eventId: string; eventUrl?: string }
  | { ok: false; status: number; error: string };

export async function scheduleAppointment(args: {
  userEmail: string;
  leadId: string;
  title?: string;
  startISO: string;
  endISO: string;
  description?: string;
}): Promise<ScheduleAppointmentResult> {
  const userEmail = String(args.userEmail || "").toLowerCase();
  if (!userEmail) return { ok: false, status: 401, error: "Unauthorized" };
  if (!args.leadId || !args.startISO || !args.endISO) {
    return { ok: false, status: 400, error: "Missing required fields (leadId, startISO, endISO)" };
  }

  try {
    await dbConnect();

    const user: any = await User.findOne({ email: userEmail });
    const refreshToken =
      user?.googleTokens?.refreshToken ||
      user?.googleTokens?.refresh_token ||
      user?.googleSheets?.refreshToken;
    if (!refreshToken) {
      return { ok: false, status: 400, error: "Google Calendar not connected for this user" };
    }

    const agentName =
      user?.name ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      String(userEmail).split("@")[0];

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
    oauth2.setCredentials({
      refresh_token: refreshToken,
      access_token: user?.googleTokens?.access_token,
      expiry_date: user?.googleTokens?.expiry_date,
    });
    const calendar = google.calendar({ version: "v3", auth: oauth2 });

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

    // Tenant-scoped lead lookup — never trusts a leadId belonging to another user.
    const lead: any = await Lead.findOne({ _id: args.leadId, userEmail });
    if (!lead) return { ok: false, status: 404, error: "Lead not found" };

    const firstName = lead.firstName || lead["First Name"] || lead.First || "";
    const lastName = lead.lastName || lead["Last Name"] || lead.Last || "";
    const leadPhone = normalizeUSPhone(lead.phone || lead.Phone || "");
    const rawLeadEmail = lead.email || lead.Email || "";
    const leadEmail = safeLeadEmailForConfirmation({
      attemptedEmail: rawLeadEmail,
      leadId: args.leadId,
      ownerEmail: userEmail,
      userEmail,
    });
    const state = lead.state || lead.State || "";
    const leadType = lead.leadType || "";
    const age = String(lead.Age || lead.age || "").trim();
    const coverageAmount = String((lead as any)["Coverage Amount"] || "").trim();
    const rawRow = (lead as any).rawRow || {};
    const getAddr = (keys: string[]) => {
      for (const k of keys) {
        const v = rawRow[k];
        if (v && String(v).trim()) return String(v).trim();
      }
      return "";
    };
    const addressField = getAddr(["Address", "address", "Street", "street"]);
    const cityField = getAddr(["City", "city"]);
    const zipField = getAddr(["Zip", "zip", "ZipCode", "zipcode"]);

    const clientTz = getTimezoneFromState(state || "") || "America/New_York";

    const startParsed = DateTime.fromISO(args.startISO, { setZone: true });
    const endParsed = DateTime.fromISO(args.endISO, { setZone: true });
    if (!startParsed.isValid || !endParsed.isValid) {
      return { ok: false, status: 400, error: "Invalid startISO/endISO" };
    }
    const startAgent = startParsed.setZone(agentTz);
    const endAgent = endParsed.setZone(agentTz);
    const startClient = startParsed.setZone(clientTz);
    if (startParsed.toUTC() <= DateTime.utc()) {
      return { ok: false, status: 400, error: "Appointment time is in the past" };
    }

    const summary = args.title || `Call with ${[firstName, lastName].filter(Boolean).join(" ") || "Lead"}`;
    const desc =
      (args.description && args.description.trim()) ||
      [leadPhone ? `Phone: ${leadPhone}` : "", leadEmail ? `Email: ${leadEmail}` : "", "Booked via CoveCRM"]
        .filter(Boolean)
        .join("\n");
    const attendees = leadEmail ? [{ email: leadEmail }] : undefined;

    const event = await calendar.events.insert({
      calendarId: user?.calendarId || "primary",
      requestBody: {
        summary,
        description: desc,
        start: { dateTime: startAgent.toJSDate().toISOString(), timeZone: agentTz },
        end: { dateTime: endAgent.toJSDate().toISOString(), timeZone: agentTz },
        attendees: attendees as any,
        reminders: { useDefault: true },
      },
      sendUpdates: "none",
    });

    const eventId = event.data.id || "";
    const eventUrl =
      event.data.htmlLink || (eventId ? `https://calendar.google.com/calendar/u/0/r/eventedit/${eventId}` : undefined);

    try {
      const numbers: Array<{ phoneNumber?: string; messagingServiceSid?: string }> = Array.isArray(user?.numbers)
        ? user.numbers
        : [];
      const msSid = numbers.find((n) => n.messagingServiceSid)?.messagingServiceSid;
      const fromNumber = numbers.find((n) => n.phoneNumber)?.phoneNumber || process.env.TWILIO_CALLER_ID;

      if (leadPhone) {
        const tzShort = (startClient as any).offsetNameShort || startClient.toFormat("ZZZZ");
        const whenStr = `${startClient.toFormat("ccc, MMM d 'at' h:mm a")} ${tzShort}`;
        const body = withStopFooter(`You're booked with ${agentName} on ${whenStr}. If you need to reschedule, reply here.`);

        await sendSms({
          to: leadPhone,
          body,
          userEmail: user.email,
          leadId: String(lead._id),
          messagingServiceSid: msSid || undefined,
          from: fromNumber || undefined,
          source: "booking_confirmation",
        });
      }
    } catch (e) {
      console.warn("[scheduleAppointment] SMS confirmation failed:", e);
    }

    try {
      const leadUrl = `${process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || ""}/lead/${lead._id}`;
      const html = renderAgentBookingEmail({
        agentName,
        leadName: [firstName, lastName].filter(Boolean).join(" ") || undefined,
        leadPhone,
        leadEmail,
        startISO: startAgent.toJSDate().toISOString(),
        endISO: endAgent.toJSDate().toISOString(),
        timezone: agentTz,
        title: summary,
        description: desc,
        leadUrl,
        eventUrl,
        leadType: leadType || undefined,
        age: age || undefined,
        coverageAmount: coverageAmount || undefined,
        address: addressField || undefined,
        city: cityField || undefined,
        zip: zipField || undefined,
        state: state || undefined,
      });
      await sendEmail(userEmail, "New booking scheduled", html);
    } catch (e) {
      console.warn("[scheduleAppointment] Agent email confirmation failed:", e);
    }

    const folder = await Folder.findOneAndUpdate(
      { userEmail, name: "Booked Appointment" },
      { $setOnInsert: { userEmail, name: "Booked Appointment", assignedDrips: [] } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    lead.folderId = folder._id;
    lead.status = "Booked Appointment";
    await lead.save();

    recordLeadOutcome({
      leadId: String(lead._id),
      userEmail: userEmail.toLowerCase(),
      rawDisposition: "booked_appointment",
      source: "calendar_booking",
      folderId: folder._id as any,
      metadata: {
        eventId,
        eventUrl: eventUrl || null,
        appointmentTime: startAgent.toJSDate().toISOString(),
      },
    }).catch((err: any) => {
      console.warn("[scheduleAppointment] outcome event failed (non-fatal):", err?.message || err);
    });

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

    return { ok: true, eventId, eventUrl };
  } catch (err: any) {
    console.error("[scheduleAppointment] error:", err?.response?.data || err?.message || err);
    return { ok: false, status: 500, error: "Internal server error" };
  }
}
