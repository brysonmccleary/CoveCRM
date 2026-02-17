// pages/api/google/calendar/book-appointment.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Booking from "@/models/Booking";
import A2PProfile from "@/models/A2PProfile";
import Message from "@/models/Message";
import twilio, { Twilio } from "twilio";
import twilioClient from "@/lib/twilioClient";
import { google } from "googleapis";
import { getTimezoneFromState } from "@/utils/timezone";
import { DateTime } from "luxon";
import { sendAppointmentBookedEmail } from "@/lib/email";
import { sendSms } from "@/lib/twilio/sendSMS"; // thread-sticky sender for confirmation
import { enforceBookingSettings } from "@/lib/booking/enforceBookingSettings";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";
const BOOKING_STUB = process.env.BOOKING_STUB === "1"; // ✅ dev bypass

// Twilio scheduling works only with a Messaging Service SID
const SHARED_MESSAGING_SERVICE_SID =
  process.env.TWILIO_MESSAGING_SERVICE_SID || "";
const MIN_SCHEDULE_LEAD_MINUTES = 15;

// ✅ Human-like delay for AI confirmations
const AI_TEST_MODE = process.env.AI_TEST_MODE === "1";
function humanDelayMinutes() {
  if (AI_TEST_MODE) return 0;
  const base = 3;
  const extra = Math.floor(Math.random() * 3); // 0,1,2 => 3–5
  return base + extra;
}

// ------- State normalization (handles "GA", "Georgia", "washington dc") -------
const STATE_CODE_FROM_NAME: Record<string, string> = {
  alabama: "AL",
  al: "AL",
  georgia: "GA",
  ga: "GA",
  florida: "FL",
  fl: "FL",
  southcarolina: "SC",
  sc: "SC",
  northcarolina: "NC",
  nc: "NC",
  virginia: "VA",
  va: "VA",
  westvirginia: "WV",
  wv: "WV",
  maryland: "MD",
  md: "MD",
  delaware: "DE",
  de: "DE",
  districtofcolumbia: "DC",
  dc: "DC",
  pennsylvania: "PA",
  pa: "PA",
  newyork: "NY",
  ny: "NY",
  newjersey: "NJ",
  nj: "NJ",
  connecticut: "CT",
  ct: "CT",
  rhodeisland: "RI",
  ri: "RI",
  massachusetts: "MA",
  ma: "MA",
  vermont: "VT",
  vt: "VT",
  newhampshire: "NH",
  nh: "NH",
  maine: "ME",
  me: "ME",
  ohio: "OH",
  oh: "OH",
  michigan: "MI",
  mi: "MI",
  indiana: "IN",
  in: "IN",
  kentucky: "KY",
  ky: "KY",
  tennessee: "TN",
  tn: "TN",
  illinois: "IL",
  il: "IL",
  wisconsin: "WI",
  wi: "WI",
  minnesota: "MN",
  mn: "MN",
  iowa: "IA",
  ia: "IA",
  missouri: "MO",
  mo: "MO",
  arkansas: "AR",
  ar: "AR",
  louisiana: "LA",
  la: "LA",
  mississippi: "MS",
  ms: "MS",
  oklahoma: "OK",
  ok: "OK",
  kansas: "KS",
  ks: "KS",
  nebraska: "NE",
  ne: "NE",
  southdakota: "SD",
  sd: "SD",
  northdakota: "ND",
  nd: "ND",
  texas: "TX",
  tx: "TX",
  colorado: "CO",
  co: "CO",
  newmexico: "NM",
  nm: "NM",
  wyoming: "WY",
  wy: "WY",
  montana: "MT",
  mt: "MT",
  utah: "UT",
  ut: "UT",
  idaho: "ID",
  id: "ID",
  arizona: "AZ",
  az: "AZ",
  california: "CA",
  ca: "CA",
  oregon: "OR",
  or: "OR",
  washington: "WA",
  wa: "WA",
  nevada: "NV",
  nv: "NV",
  alaska: "AK",
  ak: "AK",
  hawaii: "HI",
  hi: "HI",
};

const CODE_TO_ZONE: Record<string, string> = {
  AL: "America/Chicago",
  GA: "America/New_York",
  FL: "America/New_York",
  SC: "America/New_York",
  NC: "America/New_York",
  VA: "America/New_York",
  WV: "America/New_York",
  MD: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  PA: "America/New_York",
  NY: "America/New_York",
  NJ: "America/New_York",
  CT: "America/New_York",
  RI: "America/New_York",
  MA: "America/New_York",
  VT: "America/New_York",
  NH: "America/New_York",
  ME: "America/New_York",
  OH: "America/New_York",
  MI: "America/New_York",
  IN: "America/Indiana/Indianapolis",
  KY: "America/New_York",
  TN: "America/Chicago",
  IL: "America/Chicago",
  WI: "America/Chicago",
  MN: "America/Chicago",
  IA: "America/Chicago",
  MO: "America/Chicago",
  AR: "America/Chicago",
  LA: "America/Chicago",
  MS: "America/Chicago",
  OK: "America/Chicago",
  KS: "America/Chicago",
  NE: "America/Chicago",
  SD: "America/Chicago",
  ND: "America/Chicago",
  TX: "America/Chicago",
  CO: "America/Denver",
  NM: "America/Denver",
  WY: "America/Denver",
  MT: "America/Denver",
  UT: "America/Denver",
  ID: "America/Denver",
  AZ: "America/Phoenix",
  CA: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  NV: "America/Los_Angeles",
  AK: "America/Anchorage",
  HI: "Pacific/Honolulu",
};

function normalizeStateInput(raw?: string | null): string {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return STATE_CODE_FROM_NAME[s] || (STATE_CODE_FROM_NAME[s.slice(0, 2)] ?? "");
}
function zoneFromAnyState(raw?: string | null): string | null {
  const code = normalizeStateInput(raw);
  const z = code ? CODE_TO_ZONE[code] || null : null;
  return z || getTimezoneFromState(code || String(raw || "")) || null;
}
function parseClientStartISO(iso: string, clientZone: string) {
  const hasOffset = /[zZ]|[+\-]\d{2}:?\d{2}$/.test(iso);
  const base = hasOffset
    ? DateTime.fromISO(iso)
    : DateTime.fromISO(iso, { zone: clientZone });
  return base.setZone(clientZone).set({ second: 0, millisecond: 0 });
}

// ---- SMS helpers ----------------------------------------------------------
async function getSendParams(userId: string, toE164: string) {
  if (SHARED_MESSAGING_SERVICE_SID) {
    return {
      messagingServiceSid: SHARED_MESSAGING_SERVICE_SID,
      to: toE164,
    } as Parameters<Twilio["messages"]["create"]>[0];
  }
  const a2p = await A2PProfile.findOne({ userId });
  if (a2p?.messagingServiceSid) {
    return {
      messagingServiceSid: a2p.messagingServiceSid,
      to: toE164,
    } as Parameters<Twilio["messages"]["create"]>[0];
  }
  // Fallback: send from the user’s first owned number, if available
  const user = await User.findById(userId);
  const from = (user as any)?.numbers?.[0]?.phoneNumber;
  return from
    ? ({ from, to: toE164 } as Parameters<Twilio["messages"]["create"]>[0])
    : ({ to: toE164 } as any);
}
function withStopFooter(s: string) {
  return /reply stop to opt out/i.test(s) ? s : `${s} Reply STOP to opt out.`;
}
function canSchedule(params: Parameters<Twilio["messages"]["create"]>[0]) {
  return "messagingServiceSid" in params;
}
function enforceMinLead(sendAt: DateTime): DateTime {
  const minUtc = DateTime.utc().plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES });
  return sendAt.toUTC() < minUtc ? minUtc : sendAt.toUTC();
}
function toE164(phone: string) {
  const digits = String(phone).replace(/\D/g, "");
  const last10 = digits.slice(-10);
  return `+1${last10}`;
}

/**
 * POST /api/google/calendar/book-appointment
 * Auth: session OR Authorization: Bearer ${INTERNAL_API_TOKEN}
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  // ---- Auth
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  let sessionEmail: string | null = null;
  if (bearer && INTERNAL_API_TOKEN && bearer === INTERNAL_API_TOKEN) {
    sessionEmail = null; // internal call
  } else {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    sessionEmail = session.user.email;
  }

  const {
    agentEmail: bodyAgentEmail,
    name,
    phone,
    email,
    time,
    state,
    durationMinutes,
    notes,
  } = (req.body || {}) as {
    agentEmail?: string;
    name?: string;
    phone?: string;
    email?: string;
    time?: string;
    state?: string;
    durationMinutes?: number;
    notes?: string;
  };

  const agentEmail = String(bodyAgentEmail || sessionEmail || "").toLowerCase();
  if (!agentEmail || !name || !phone || !time || !state) {
    res.status(400).json({ message: "Missing required fields" });
    return;
  }

  // ===================== DEV STUB (no Google required) =====================
  if (BOOKING_STUB && bearer && INTERNAL_API_TOKEN && bearer === INTERNAL_API_TOKEN) {
    try {
      await dbConnect();

      const user = await User.findOne({ email: agentEmail });
      if (!user) return res.status(404).json({ message: "Agent not found" });

      const clientZone = zoneFromAnyState(state) || "America/New_York";
      const clientStart = parseClientStartISO(String(time), clientZone);
      if (!clientStart.isValid) {
        res.status(400).json({ message: "Invalid time" });
        return;
      }
      const dur = Math.max(15, Math.min(240, Number(durationMinutes || 30)));
      const clientEnd = clientStart.plus({ minutes: dur });

      const to = toE164(String(phone));
      const last10 = to.slice(-10);

      let lead =
        (await Lead.findOne({
          userEmail: user.email,
          Phone: { $regex: last10 },
        })) ||
        (await Lead.findOne({
          userEmail: user.email,
          phone: { $regex: last10 },
        }));

      if (!lead) {
        lead = await Lead.create({
          "First Name": name,
          Phone: to,
          Email: email || "",
          userEmail: user.email,
          appointmentTime: clientStart.toJSDate(),
          status: "Booked",
          State: state,
          Notes: notes ? `Booked via API (stub): ${notes}` : "Booked via API (stub)",
        });
      } else {
        await Lead.updateOne(
          { _id: lead._id },
          {
            $set: {
              "First Name": (lead as any)["First Name"] || name,
              Email: lead.Email || email || "",
              appointmentTime: clientStart.toJSDate(),
              status: "Booked",
              State: (lead as any).State || (lead as any).state || state,
            },
          },
        );
      }

      // Send confirmation via thread-sticky sender (AI flow => human-like delay)
      const tzShort = clientStart.offsetNameShort;
      const readable = clientStart.toFormat("ccc, MMM d 'at' h:mm a");
      const confirmBody = withStopFooter(
        `You're confirmed for ${readable} ${tzShort}. We'll call you then. Reply RESCHEDULE if you need to change it.`,
      );
      await sendSms({
        to,
        body: confirmBody,
        userEmail: user.email,
        leadId: String(lead._id),
        delayMinutes: humanDelayMinutes(),
      });

      // Fake a successful calendar response
      const agentZone =
        (user as any)?.bookingSettings?.timezone || "America/Los_Angeles";
      const agentLocalStart = clientStart.setZone(agentZone);
      const agentLocalEnd = clientEnd.setZone(agentZone);

      res.status(200).json({
        success: true,
        eventId: "dev-stub-event",
        htmlLink: "https://calendar.google.com/calendar/u/0/r",
        clientStartISO: clientStart.toISO(),
        clientEndISO: clientEnd.toISO(),
        clientZone,
        agentLocalStartISO: agentLocalStart.toISO(),
        agentLocalEndISO: agentLocalEnd.toISO(),
        agentZone,
        leadId: lead._id,
        stub: true,
      });
      return;
    } catch (e: any) {
      console.error("❌ Booking stub error:", e?.message || e);
      res.status(500).json({ success: false, message: "Stub failed" });
      return;
    }
  }
  // ========================================================================

  await dbConnect();

  const user = await User.findOne({ email: agentEmail });
  if (!user) {
    res.status(404).json({ message: "Agent not found" });
    return;
  }

  const refreshToken =
    (user as any)?.googleTokens?.refreshToken ||
    (user as any)?.googleSheets?.refreshToken;

  if (!refreshToken) {
    res.status(400).json({
      message:
        "Agent not connected to Google. Please connect Google in Settings.",
    });
    return;
  }

  // ---- Time zones
  const clientZone = zoneFromAnyState(state) || "America/New_York";
  const agentZone =
    (user as any)?.bookingSettings?.timezone || "America/Los_Angeles";

  const clientStart = parseClientStartISO(String(time), clientZone);
  if (!clientStart.isValid) {
    res.status(400).json({ message: "Invalid time" });
    return;
  }

  const dur = Math.max(15, Math.min(240, Number(durationMinutes || 30)));
  const clientEnd = clientStart.plus({ minutes: dur });

  // ---- Google Calendar
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  // ---- Normalize data
  const to = toE164(String(phone));
  const last10 = to.slice(-10);
  const calendarId = (user as any)?.calendarId || "primary";

  // ---- Create/Update Lead
  const existingLead =
    (await Lead.findOne({
      userEmail: user.email,
      Phone: { $regex: last10 },
    })) ||
    (await Lead.findOne({ userEmail: user.email, Phone: `+1${last10}` })) ||
    (await Lead.findOne({
      userEmail: user.email,
      phone: { $regex: last10 },
    })) ||
    (await Lead.findOne({ userEmail: user.email, phone: `+1${last10}` }));

  const appointmentJS = clientStart.toJSDate();
  let leadId = existingLead?._id;

  if (existingLead) {
    await Lead.updateOne(
      { _id: existingLead._id },
      {
        $set: {
          "First Name":
            (existingLead as any)["First Name"] ||
            (existingLead as any)["First"] ||
            name,
          Email: existingLead.Email || email || "",
          appointmentTime: appointmentJS,
          status: "Booked",
          State:
            (existingLead as any).State || (existingLead as any).state || state,
        },
      },
    );
  } else {
    const createdLead = await Lead.create({
      "First Name": name,
      Phone: to,
      Email: email || "",
      userEmail: user.email,
      appointmentTime: appointmentJS,
      status: "Booked",
      State: state,
      Notes: notes ? `Booked via API: ${notes}` : "Booked via API",
    });
    leadId = createdLead._id;
  }

  try {
    // ---- Enforce agent booking settings (working hours, step, busy, max/day) ----
    try {
      const out = await enforceBookingSettings({
        calendar,
        calendarId,
        bookingSettings: (user as any)?.bookingSettings,
        requestedStart: clientStart, // instant is client-facing; enforcer converts to agent tz internally
        durationMinutes: dur,
        outputZone: clientZone, // suggestions should be lead/client facing
        suggestionLimit: 5,
      });

      if (!out.ok) {
        return res.status(409).json({
          success: false,
          message: "Requested time unavailable",
          reason: out.reason || "invalid",
          ...(Array.isArray(out.suggestions) ? { suggestions: out.suggestions } : {}),
        } as any);
      }
    } catch (e: any) {
      console.warn(
        "[BOOK-APPOINTMENT] Booking enforcement failed (non-blocking):",
        e?.message || e,
      );
      // If enforcement fails unexpectedly, do NOT block booking to avoid breaking launch flows.
    }

    // ---- Insert Calendar Event (client TZ; Google converts for agent) ----
    const requestBody = {
      summary: `Call with ${name}`,
      description:
        `Client phone: ${to}` +
        (email ? `\nEmail: ${email}` : "") +
        (notes ? `\nNotes: ${notes}` : "") +
        `\nBooked via CoveCRM`,
      start: { dateTime: clientStart.toISO(), timeZone: clientZone },
      end: { dateTime: clientEnd.toISO(), timeZone: clientZone },
      attendees: email ? [{ email }] : undefined,
      reminders: { useDefault: true },
    } as any;

    const created = await calendar.events.insert({
      calendarId,
      requestBody,
      sendUpdates: "none",
    });

    // ---- Save booking metadata -------------------------------------------
    // NOTE: Many leads are phone-only. Also, some deployed bundles may still
    // have leadEmail marked required, so we guarantee a non-empty value here.
    const leadEmailSafe =
      typeof email === "string" && email.trim()
        ? email.trim()
        : `noemail+${to.slice(-10)}@covecrm.local`;
    await Booking.create({
      leadEmail: leadEmailSafe,
      leadPhone: to,
      agentEmail: user.email,
      agentPhone: (user as any)?.phoneNumber || "",
      date: appointmentJS,
      timezone: clientZone,
      reminderSent: {
        confirm: false,
        morning: false,
        hour: false,
        fifteen: false,
      },
      eventId: created.data.id,
    });

    // 🔔 UI update
    const io = (res.socket as any)?.server?.io;
    if (io) {
      io.to(user.email).emit("calendarUpdated", { eventId: created.data.id });
      io.to(`user-${user.email}`).emit("calendarUpdated", {
        eventId: created.data.id,
      });
    }

    // ------------------ SMS: confirmation + reminders ----------------------
    const tzShort = clientStart.offsetNameShort; // e.g., EDT / MST
    const readable = clientStart.toFormat("ccc, MMM d 'at' h:mm a");

    const confirmBody = withStopFooter(
      `You're confirmed for ${readable} ${tzShort}. We'll call you then. Reply RESCHEDULE if you need to change it.`,
    );
    const morningBody = withStopFooter(
      `Reminder: our call is today at ${clientStart.toFormat("h:mm a")} ${tzShort}. Reply RESCHEDULE if needed.`,
    );
    const hourBody = withStopFooter(
      `Heads up: our call is in 1 hour at ${clientStart.toFormat("h:mm a")} ${tzShort}.`,
    );
    const fifteenBody = withStopFooter(
      `Quick reminder: our call is in 15 minutes at ${clientStart.toFormat("h:mm a")} ${tzShort}.`,
    );

    const nowClient = DateTime.now().setZone(clientZone);

    // 1) Confirmation NOW from the SAME THREAD NUMBER (sticky "from")
    if (leadId) {
      const isAI = !!(bearer && INTERNAL_API_TOKEN && bearer === INTERNAL_API_TOKEN);
      await sendSms({
        to,
        body: confirmBody,
        userEmail: user.email,
        leadId: String(leadId),
        // ✅ Only AI SMS assistant confirmations get the 3–5 min human delay;
        // manual bookings still go out immediately.
        delayMinutes: isAI ? humanDelayMinutes() : undefined,
      });
    } else {
      const paramsBase = await getSendParams(String((user as any)._id), to);
      await twilioClient.messages.create({ ...paramsBase, body: confirmBody });
    }

    // Helper to send/schedule + persist Message (used for reminders only)
    const sendOrSchedule = async (body: string, scheduledAt?: DateTime) => {
      const paramsBase = await getSendParams(String((user as any)._id), to);
      const params: Parameters<Twilio["messages"]["create"]>[0] = {
        ...paramsBase,
        body,
      };

      let sentAt = new Date();
      if (scheduledAt && canSchedule(params)) {
        const dt = enforceMinLead(scheduledAt);
        const sendAtUTC = dt.toISO();
        if (sendAtUTC) {
          (params as any).scheduleType = "fixed";
          (params as any).sendAt = sendAtUTC;
        }
        sentAt = dt.toJSDate();
      } else if (scheduledAt && !canSchedule(params)) {
        console.warn(
          "⚠️ Cannot schedule without Messaging Service SID — sending immediately.",
        );
      }

      const tw = await twilioClient.messages.create(params);

      await Message.create({
        leadId,
        userEmail: user.email,
        direction: "outbound",
        text: body,
        read: true,
        to,
        from: (params as any).from,
        fromServiceSid: (params as any).messagingServiceSid,
        sid: (tw as any)?.sid,
        status: (tw as any)?.status,
        sentAt,
      });
    };

    // 2) Morning-of at 9:00 AM local (only if appointment is on a later day)
    const isFutureDay = clientStart.startOf("day") > nowClient.startOf("day");
    if (isFutureDay) {
      const morning = clientStart.set({
        hour: 9,
        minute: 0,
        second: 0,
        millisecond: 0,
      });
      if (morning > nowClient.plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES })) {
        await sendOrSchedule(morningBody, morning);
      }
    }

    // 3) 1-hour-before (only if still in future)
    const oneHourBefore = clientStart.minus({ hours: 1 });
    if (
      oneHourBefore > nowClient.plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES })
    ) {
      await sendOrSchedule(hourBody, oneHourBefore);
    }

    // 4) 15-min-before (only if still in future)
    const fifteenBefore = clientStart.minus({ minutes: 15 });
    if (
      fifteenBefore > nowClient.plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES })
    ) {
      await sendOrSchedule(fifteenBody, fifteenBefore);
    }

    // ✅ Email the agent a booking notice (time derived from same clientStart)
    try {
      await sendAppointmentBookedEmail({
        to: user.email,
        agentName: (user as any)?.name || user.email.split("@")[0],
        leadName: name,
        phone: to,
        state,
        timeISO: clientStart.toISO()!,
        timezone: tzShort,
        source: bearer && bearer === INTERNAL_API_TOKEN ? "AI" : "Manual",
        eventUrl: created.data.htmlLink || undefined,
      });
    } catch (e) {
      console.warn(
        "Email notice failed (non-blocking):",
        (e as any)?.message || e,
      );
    }

    // Agent-local echoes (for response)
    const agentLocalStart = clientStart.setZone(agentZone);
    const agentLocalEnd = clientEnd.setZone(agentZone);

    res.status(200).json({
      success: true,
      eventId: created.data.id,
      htmlLink: created.data.htmlLink,
      clientStartISO: clientStart.toISO(),
      clientEndISO: clientEnd.toISO(),
      clientZone,
      agentLocalStartISO: agentLocalStart.toISO(),
      agentLocalEndISO: agentLocalEnd.toISO(),
      agentZone,
      leadId,
    });
    return;
  } catch (err: any) {
    const detail = err?.response?.data || err?.errors || err?.message || err;
    console.error("❌ Calendar booking error:", detail);
    res.status(500).json({
      success: false,
      message: "Failed to book appointment",
      error: typeof detail === "string" ? detail : JSON.stringify(detail),
    });
    return;
  }
}
