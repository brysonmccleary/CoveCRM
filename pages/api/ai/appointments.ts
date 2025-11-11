// pages/api/ai/appointments.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import axios from "axios";
import { DateTime } from "luxon";

import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";
import Message from "@/models/Message";
import { sendSms } from "@/lib/twilio/sendSMS";
import { resolveLeadDisplayName } from "@/lib/email";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";

// ——— Utilities ———
function pickLeadZone(lead: any): string {
  const s = String(lead?.State || (lead as any)?.state || "").trim();
  const byState: Record<string, string> = {
    AZ: "America/Phoenix",
    CA: "America/Los_Angeles",
    NV: "America/Los_Angeles",
    OR: "America/Los_Angeles",
    WA: "America/Los_Angeles",
    CO: "America/Denver",
    MT: "America/Denver",
    NM: "America/Denver",
    UT: "America/Denver",
    WY: "America/Denver",
    AL: "America/Chicago", AR: "America/Chicago", IA: "America/Chicago", IL: "America/Chicago",
    KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", MN: "America/Chicago",
    MO: "America/Chicago", MS: "America/Chicago", ND: "America/Chicago", NE: "America/Chicago",
    OK: "America/Chicago", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
    CT: "America/New_York", DC: "America/New_York", DE: "America/New_York", FL: "America/New_York",
    GA: "America/New_York", MA: "America/New_York", MD: "America/New_York", ME: "America/New_York",
    MI: "America/New_York", NC: "America/New_York", NH: "America/New_York", NJ: "America/New_York",
    NY: "America/New_York", OH: "America/New_York", PA: "America/New_York", RI: "America/New_York",
    SC: "America/New_York", VA: "America/New_York", VT: "America/New_York",
    AK: "America/Anchorage", HI: "Pacific/Honolulu",
  };
  const key = s.toUpperCase().replace(/[^A-Z]/g, "");
  return byState[key] || "America/New_York";
}

function formatConfirmCopy(dtISO: string, zone: string) {
  const dt = DateTime.fromISO(dtISO, { zone }).set({ second: 0, millisecond: 0 });
  const readable = dt.toFormat("ccc, MMM d 'at' h:mm a");
  const offset = dt.offsetNameShort;
  return {
    text: `Perfect — I’ve got you down for ${readable} ${offset}. You’ll get a confirmation shortly. Reply RESCHEDULE if you need to change it.`,
    readable, // used for de-dupe search
  };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** choose a thread-sticky "from" number if possible */
async function pickFromNumberForThread(leadId: string, userEmail: string) {
  const last = await Message.findOne({ leadId }).sort({ createdAt: -1 }).lean();
  const user = await User.findOne({ email: userEmail }).lean();
  const owned: string[] = Array.from(
    new Set(
      (Array.isArray(user?.numbers) ? user!.numbers : [])
        .map((n: any) => (typeof n === "string" ? n : (n?.phoneNumber || n?.number)))
        .filter(Boolean)
    )
  );
  if (!owned.length) return null;
  if (last) {
    const candidate = (last as any).direction === "inbound" ? (last as any).to : (last as any).from;
    if (candidate && owned.includes(candidate)) return candidate;
  }
  return owned[0] || null;
}

// ——— Handler ———
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    if (!mongoose.connection.readyState) await dbConnect();

    const { leadId, agentEmail, timeISO, durationMinutes = 30, notes } = req.body || {};
    if (!leadId || !agentEmail || !timeISO) {
      return res.status(400).json({ message: "Missing required fields (leadId, agentEmail, timeISO)" });
    }

    const lead: any = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const userEmail = (lead.userEmail || agentEmail || "").toLowerCase();
    const zone = pickLeadZone(lead);

    // 1) Book via the existing Google Calendar endpoint (which may already send confirm+reminders)
    const bookingUrl = `${BASE_URL}/api/google/calendar/book-appointment`;
    const bookResp = await axios.post(
      bookingUrl,
      {
        agentEmail: userEmail,
        name: resolveLeadDisplayName(lead) || "Client",
        phone: lead.Phone || (lead as any).phone || "",
        email: lead.Email || (lead as any).email || "",
        time: timeISO,
        state: String(lead.State || (lead as any).state || "AZ"),
        durationMinutes,
        notes: notes || "Booked via /api/ai/appointments",
      },
      {
        headers: { Authorization: `Bearer ${INTERNAL_API_TOKEN}`, "Content-Type": "application/json" },
        timeout: 15000,
      },
    );

    const ok = (bookResp.data && (bookResp.data.success === true || (bookResp.status >= 200 && bookResp.status < 300)));
    if (!ok) {
      return res.status(500).json({ message: "Booking failed", detail: bookResp.data });
    }

    // 2) Persist basic booking flags on the lead
    lead.status = "Booked";
    (lead as any).appointmentTime = DateTime.fromISO(timeISO).toJSDate();
    (lead as any).aiLastConfirmedISO = DateTime.fromISO(timeISO).toISO();

    // 3) De-dupe: if a confirmation containing the formatted local time
    //    was already sent in the last 15 minutes, skip our own confirm.
    const { text: confirmText, readable } = formatConfirmCopy(timeISO, zone);
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const timePhrase = escapeRegExp(readable); // "Wed, Nov 12 at 8:00 PM"

    const alreadySent = await Message.findOne({
      leadId: lead._id,
      userEmail,
      direction: "outbound",
      createdAt: { $gte: since },
      text: { $regex: timePhrase, $options: "i" },
    }).lean();

    let confirmationSent = false;

    if (!alreadySent) {
      // 4) Send confirmation SMS from the thread-sticky number
      const fromOverride = await pickFromNumberForThread(String(lead._id), userEmail);
      await sendSms({
        to: lead.Phone || (lead as any).phone || "",
        body: confirmText,
        userEmail,
        leadId: String(lead._id),
        from: fromOverride || undefined,
      });

      // mirror into interactionHistory as an AI entry
      lead.interactionHistory = Array.isArray(lead.interactionHistory) ? lead.interactionHistory : [];
      lead.interactionHistory.push({ type: "ai", text: confirmText, date: new Date() } as any);
      confirmationSent = true;
    }

    await lead.save();

    return res.status(200).json({
      success: true,
      event: bookResp.data?.event || bookResp.data,
      confirmationSent,
      skippedBecauseRecent: Boolean(alreadySent),
    });
  } catch (err: any) {
    console.error("[ai/appointments] error:", err?.response?.data || err);
    return res.status(500).json({ success: false, message: "Internal error" });
  }
}
