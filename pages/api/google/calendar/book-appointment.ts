import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Booking from "@/models/Booking";
import { google } from "googleapis";
import { getTimezoneFromState } from "@/utils/timezone";
import { DateTime } from "luxon";
import { sendAppointmentBookedEmail } from "@/lib/email";
import { sendSms } from "@/lib/twilio/sendSMS";
import { detectTimezoneFromReq } from "@/lib/ipTimezone";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";
const BOOKING_STUB = process.env.BOOKING_STUB === "1";

// we keep the same minimum schedule lead as the SMS helper
const MIN_SCHEDULE_LEAD_MINUTES = 15;

// ------- State normalization -------
const STATE_CODE_FROM_NAME: Record<string, string> = {
  alabama: "AL", al: "AL", georgia: "GA", ga: "GA", florida: "FL", fl: "FL",
  southcarolina: "SC", sc: "SC", northcarolina: "NC", nc: "NC", virginia: "VA", va: "VA",
  westvirginia: "WV", wv: "WV", maryland: "MD", md: "MD", delaware: "DE", de: "DE",
  districtofcolumbia: "DC", dc: "DC", pennsylvania: "PA", pa: "PA", newyork: "NY", ny: "NY",
  newjersey: "NJ", nj: "NJ", connecticut: "CT", ct: "CT", rhodeisland: "RI", ri: "RI",
  massachusetts: "MA", ma: "MA", vermont: "VT", vt: "VT", newhampshire: "NH", nh: "NH",
  maine: "ME", me: "ME", ohio: "OH", oh: "OH", michigan: "MI", mi: "MI", indiana: "IN", in: "IN",
  kentucky: "KY", ky: "KY", tennessee: "TN", tn: "TN", illinois: "IL", il: "IL", wisconsin: "WI", wi: "WI",
  minnesota: "MN", mn: "MN", iowa: "IA", ia: "IA", missouri: "MO", mo: "MO", arkansas: "AR", ar: "AR",
  louisiana: "LA", la: "LA", mississippi: "MS", ms: "MS", oklahoma: "OK", ok: "OK", kansas: "KS", ks: "KS",
  nebraska: "NE", ne: "NE", southdakota: "SD", sd: "SD", northdakota: "ND", nd: "ND", texas: "TX", tx: "TX",
  colorado: "CO", co: "CO", newmexico: "NM", nm: "NM", wyoming: "WY", wy: "WY", montana: "MT", mt: "MT",
  utah: "UT", ut: "UT", idaho: "ID", id: "ID", arizona: "AZ", az: "AZ", california: "CA", ca: "CA",
  oregon: "OR", or: "OR", washington: "WA", wa: "WA", nevada: "NV", nv: "NV", alaska: "AK", ak: "AK",
  hawaii: "HI", hi: "HI",
};

const CODE_TO_ZONE: Record<string, string> = {
  AL: "America/Chicago", GA: "America/New_York", FL: "America/New_York", SC: "America/New_York",
  NC: "America/New_York", VA: "America/New_York", WV: "America/New_York", MD: "America/New_York",
  DE: "America/New_York", DC: "America/New_York", PA: "America/New_York", NY: "America/New_York",
  NJ: "America/New_York", CT: "America/New_York", RI: "America/New_York", MA: "America/New_York",
  VT: "America/New_York", NH: "America/New_York", ME: "America/New_York", OH: "America/New_York",
  MI: "America/New_York", IN: "America/Indiana/Indianapolis", KY: "America/New_York", TN: "America/Chicago",
  IL: "America/Chicago", WI: "America/Chicago", MN: "America/Chicago", IA: "America/Chicago",
  MO: "America/Chicago", AR: "America/Chicago", LA: "America/Chicago", MS: "America/Chicago",
  OK: "America/Chicago", KS: "America/Chicago", NE: "America/Chicago", SD: "America/Chicago",
  ND: "America/Chicago", TX: "America/Chicago", CO: "America/Denver", NM: "America/Denver",
  WY: "America/Denver", MT: "America/Denver", UT: "America/Denver", ID: "America/Denver",
  AZ: "America/Phoenix", CA: "America/Los_Angeles", OR: "America/Los_Angeles",
  WA: "America/Los_Angeles", NV: "America/Los_Angeles", AK: "America/Anchorage", HI: "Pacific/Honolulu",
};

function normalizeStateInput(raw?: string | null): string {
  const s = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  return STATE_CODE_FROM_NAME[s] || (STATE_CODE_FROM_NAME[s.slice(0, 2)] ?? "");
}
function zoneFromAnyState(raw?: string | null): string | null {
  const code = normalizeStateInput(raw);
  const z = code ? CODE_TO_ZONE[code] || null : null;
  return z || getTimezoneFromState(code || String(raw || "")) || null;
}
function parseClientStartISO(iso: string, clientZone: string) {
  const hasOffset = /[zZ]|[+\-]\d{2}:?\d{2}$/.test(iso);
  const base = hasOffset ? DateTime.fromISO(iso) : DateTime.fromISO(iso, { zone: clientZone });
  return base.setZone(clientZone).set({ second: 0, millisecond: 0 });
}

// ---- Local helpers ----------------------------------------------------------
function withStopFooter(s: string) {
  return /reply stop to opt out/i.test(s) ? s : `${s} Reply STOP to opt out.`;
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
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.status(405).end(); return; }

  // ---- Auth
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  let sessionEmail: string | null = null;
  if (bearer && INTERNAL_API_TOKEN && bearer === INTERNAL_API_TOKEN) {
    sessionEmail = null;
  } else {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) { res.status(401).json({ message: "Unauthorized" }); return; }
    sessionEmail = session.user.email;
  }

  const { agentEmail: bodyAgentEmail, name, phone, email, time, state, durationMinutes, notes } = (req.body || {}) as {
    agentEmail?: string; name?: string; phone?: string; email?: string; time?: string; state?: string; durationMinutes?: number; notes?: string;
  };

  const agentEmail = String(bodyAgentEmail || sessionEmail || "").toLowerCase();
  if (!agentEmail || !name || !phone || !time || !state) {
    res.status(400).json({ message: "Missing required fields" });
    return;
  }

  // =================== DEV STUB ===================
  if (BOOKING_STUB && bearer && INTERNAL_API_TOKEN && bearer === INTERNAL_API_TOKEN) {
    try {
      await dbConnect();
      const user = await User.findOne({ email: agentEmail });
      if (!user) return res.status(404).json({ message: "Agent not found" });

      // --- Agent TZ auto-detect & persist (stub path too)
      const detectedTz = await detectTimezoneFromReq(req);
      const currentAgentTz = (user as any)?.bookingSettings?.timezone || null;
      const agentZonePersist = detectedTz || currentAgentTz || "America/Los_Angeles";
      if (!currentAgentTz && detectedTz) {
        await User.updateOne(
          { _id: user._id },
          { $set: { "bookingSettings.timezone": detectedTz } },
        );
        console.log("[booking] persisted agent timezone", { agentEmail, detectedTz });
      }

      const clientZone = zoneFromAnyState(state) || "America/New_York";
      const clientStart = parseClientStartISO(String(time), clientZone);
      if (!clientStart.isValid) { res.status(400).json({ message: "Invalid time" }); return; }
      const dur = Math.max(15, Math.min(240, Number(durationMinutes || 30)));
      const clientEnd = clientStart.plus({ minutes: dur });

      const to = toE164(String(phone));
      const last10 = to.slice(-10);

      let lead =
        (await Lead.findOne({ userEmail: user.email, Phone: { $regex: last10 } })) ||
        (await Lead.findOne({ userEmail: user.email, phone: { $regex: last10 } }));

      if (!lead) {
        lead = await Lead.create({
          "First Name": name, Phone: to, Email: email || "", userEmail: user.email,
          appointmentTime: clientStart.toJSDate(), status: "Booked", State: state,
          Notes: notes ? `Booked via API (stub): ${notes}` : "Booked via API (stub)",
        });
      } else {
        await Lead.updateOne({ _id: lead._id }, {
          $set: {
            "First Name": (lead as any)["First Name"] || name,
            Email: lead.Email || email || "",
            appointmentTime: clientStart.toJSDate(),
            status: "Booked",
            State: (lead as any).State || (lead as any).state || state,
          },
        });
      }

      const tzShort = clientStart.offsetNameShort;
      const readable = clientStart.toFormat("ccc, MMM d 'at' h:mm a");
      await sendSms({
        to,
        body: withStopFooter(`You're confirmed for ${readable} ${tzShort}. We'll call you then. Reply RESCHEDULE if you need to change it.`),
        userEmail: user.email,
        leadId: String(lead._id),
      });

      res.status(200).json({
        success: true,
        eventId: "dev-stub-event",
        htmlLink: "https://calendar.google.com/calendar/u/0/r",
        clientStartISO: clientStart.toISO(),
        clientEndISO: clientEnd.toISO(),
        clientZone,
        agentLocalStartISO: clientStart.setZone(agentZonePersist).toISO(),
        agentLocalEndISO: clientEnd.setZone(agentZonePersist).toISO(),
        agentZone: agentZonePersist,
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
  // ===============================================

  await dbConnect();

  const user = await User.findOne({ email: agentEmail });
  if (!user) { res.status(404).json({ message: "Agent not found" }); return; }

  const refreshToken =
    (user as any)?.googleTokens?.refreshToken ||
    (user as any)?.googleSheets?.refreshToken;

  if (!refreshToken) {
    res.status(400).json({ message: "Agent not connected to Google. Please connect Google in Settings." });
    return;
  }

  // ---- Time zones
  const clientZone = zoneFromAnyState(state) || "America/New_York";

  // Detect and persist agent TZ from IP (automatic, per user)
  const detectedTz = await detectTimezoneFromReq(req);
  const currentAgentTz = (user as any)?.bookingSettings?.timezone || null;
  const agentZone = detectedTz || currentAgentTz || "America/Los_Angeles";

  if (!currentAgentTz && detectedTz) {
    await User.updateOne(
      { _id: user._id },
      { $set: { "bookingSettings.timezone": detectedTz } },
    );
    console.log("[booking] persisted agent timezone", { agentEmail, detectedTz });
  }

  const clientStart = parseClientStartISO(String(time), clientZone);
  if (!clientStart.isValid) { res.status(400).json({ message: "Invalid time" }); return; }

  const dur = Math.max(15, Math.min(240, Number(durationMinutes || 30)));
  const clientEnd = clientStart.plus({ minutes: dur });

  // ---- Google Calendar
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  // ---- Normalize data
  const to = toE164(String(phone));
  const last10 = to.slice(-10);
  const calendarId = (user as any)?.calendarId || "primary";

  // ---- Create/Update Lead
  const existingLead =
    (await Lead.findOne({ userEmail: user.email, Phone: { $regex: last10 } })) ||
    (await Lead.findOne({ userEmail: user.email, Phone: `+1${last10}` })) ||
    (await Lead.findOne({ userEmail: user.email, phone: { $regex: last10 } })) ||
    (await Lead.findOne({ userEmail: user.email, phone: `+1${last10}` }));

  const appointmentJS = clientStart.toJSDate();
  let leadId = existingLead?._id;

  if (existingLead) {
    await Lead.updateOne({ _id: existingLead._id }, {
      $set: {
        "First Name": (existingLead as any)["First Name"] || (existingLead as any)["First"] || name,
        Email: existingLead.Email || email || "",
        appointmentTime: appointmentJS,
        status: "Booked",
        State: (existingLead as any).State || (existingLead as any).state || state,
      },
    });
  } else {
    const createdLead = await Lead.create({
      "First Name": name, Phone: to, Email: email || "", userEmail: user.email,
      appointmentTime: appointmentJS, status: "Booked", State: state,
      Notes: notes ? `Booked via API: ${notes}` : "Booked via API",
    });
    leadId = createdLead._id;
  }

  try {
    // ---- Insert Calendar Event (client TZ) ----
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

    const created = await calendar.events.insert({ calendarId, requestBody, sendUpdates: "none" });

    // ---- Save booking ----
    await Booking.create({
      leadEmail: email || "",
      leadPhone: to,
      agentEmail: user.email,
      agentPhone: (user as any)?.phoneNumber || "",
      date: appointmentJS,
      timezone: clientZone,
      reminderSent: { confirm: false, morning: false, hour: false, fifteen: false },
      eventId: created.data.id,
    });

    // 🔔 UI update
    const io = (res.socket as any)?.server?.io;
    if (io) {
      io.to(user.email).emit("calendarUpdated", { eventId: created.data.id });
      io.to(`user-${user.email}`).emit("calendarUpdated", { eventId: created.data.id });
    }

    // ------------------ SMS confirmations/reminders (unchanged) ----------------------
    const tzShort = clientStart.offsetNameShort;
    const readable = clientStart.toFormat("ccc, MMM d 'at' h:mm a");

    const confirmBody = withStopFooter(
      `You're confirmed for ${readable} ${tzShort}. We'll call you then. Reply RESCHEDULE if you need to change it.`
    );
    const morningBody = withStopFooter(
      `Reminder: our call is today at ${clientStart.toFormat("h:mm a")} ${tzShort}. Reply RESCHEDULE if needed.`
    );
    const hourBody = withStopFooter(
      `Heads up: our call is in 1 hour at ${clientStart.toFormat("h:mm a")} ${tzShort}.`
    );
    const fifteenBody = withStopFooter(
      `Quick reminder: our call is in 15 minutes at ${clientStart.toFormat("h:mm a")} ${tzShort}.`
    );

    // 1) Confirmation NOW
    await sendSms({ to, body: confirmBody, userEmail: user.email, leadId: String(leadId) });

    // Ensure minimum lead time then schedule reminders in client's TZ
    const futureIsoOrNull = (dt: DateTime) => {
      const min = DateTime.now().setZone(clientZone).plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES });
      if (dt <= min) return null;
      return dt.toUTC().toISO();
    };

    const nowClient = DateTime.now().setZone(clientZone);
    const isFutureDay = clientStart.startOf("day") > nowClient.startOf("day");
    if (isFutureDay) {
      const morning = clientStart.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
      const iso = futureIsoOrNull(morning);
      if (iso) await sendSms({ to, body: morningBody, userEmail: user.email, leadId: String(leadId), sendAtISO: iso });
    }

    const oneHourBefore = clientStart.minus({ hours: 1 });
    {
      const iso = futureIsoOrNull(oneHourBefore);
      if (iso) await sendSms({ to, body: hourBody, userEmail: user.email, leadId: String(leadId), sendAtISO: iso });
    }

    const fifteenBefore = clientStart.minus({ minutes: 15 });
    {
      const iso = futureIsoOrNull(fifteenBefore);
      if (iso) await sendSms({ to, body: fifteenBody, userEmail: user.email, leadId: String(leadId), sendAtISO: iso });
    }

    // Agent-local echoes (using detected-or-stored agentZone)
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
