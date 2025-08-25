// pages/api/assistants/booking.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { OpenAI } from "openai";
import axios from "axios";
import { DateTime } from "luxon";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";

/** Compact, insurance-focused behavior */
const SYSTEM_PROMPT = `
You are Cove CRM's booking assistant for insurance appointments.
Be friendly and concise (1–2 sentences). Always steer toward scheduling.
Collect what's missing: full name, phone (US), state, and desired date/time (email optional; 30 mins default).
If they give a casual time like "tomorrow 3pm", that's fine—I'll convert it. Avoid quotes/policy details.
`.trim();

/** Helper to safely read tool call shapes across SDK versions */
type FnToolCall = {
  type?: string;
  function?: { name?: string; arguments?: string };
} & Record<string, any>;

// ---- state → timezone helpers (lightweight local copy)
const STATE_CODE_FROM_NAME: Record<string, string> = {
  alabama: "AL", al: "AL", georgia: "GA", ga: "GA", florida: "FL", fl: "FL",
  southcarolina: "SC", sc: "SC", northcarolina: "NC", nc: "NC", virginia: "VA", va: "VA",
  westvirginia: "WV", wv: "WV", maryland: "MD", md: "MD", delaware: "DE", de: "DE",
  districtofcolumbia: "DC", dc: "DC", pennsylvania: "PA", pa: "PA", newyork: "NY", ny: "NY",
  newjersey: "NJ", nj: "NJ", connecticut: "CT", ct: "CT", rhodeisland: "RI", ri: "RI",
  massachusetts: "MA", ma: "MA", vermont: "VT", vt: "VT", newhampshire: "NH", nh: "NH",
  maine: "ME", me: "ME", ohio: "OH", oh: "OH", michigan: "MI", mi: "MI", indiana: "IN", in: "IN",
  kentucky: "KY", ky: "KY", tennessee: "TN", tn: "TN", illinois: "IL", il: "IL",
  wisconsin: "WI", wi: "WI", minnesota: "MN", mn: "MN", iowa: "IA", ia: "IA", missouri: "MO", mo: "MO",
  arkansas: "AR", ar: "AR", louisiana: "LA", la: "LA", mississippi: "MS", ms: "MS", oklahoma: "OK", ok: "OK",
  kansas: "KS", ks: "KS", nebraska: "NE", ne: "NE", southdakota: "SD", sd: "SD",
  northdakota: "ND", nd: "ND", texas: "TX", tx: "TX", colorado: "CO", co: "CO", newmexico: "NM", nm: "NM",
  wyoming: "WY", wy: "WY", montana: "MT", mt: "MT", utah: "UT", ut: "UT", idaho: "ID", id: "ID",
  arizona: "AZ", az: "AZ", california: "CA", ca: "CA", oregon: "OR", or: "OR", washington: "WA", wa: "WA",
  nevada: "NV", nv: "NV", alaska: "AK", ak: "AK", hawaii: "HI", hi: "HI",
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
  ND: "America/Chicago", TX: "America/Chicago",
  CO: "America/Denver", NM: "America/Denver", WY: "America/Denver", MT: "America/Denver",
  UT: "America/Denver", ID: "America/Denver", AZ: "America/Phoenix",
  CA: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles", NV: "America/Los_Angeles",
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
};
const TZ_ABBR: Record<string, string> = {
  est: "America/New_York", edt: "America/New_York",
  cst: "America/Chicago", cdt: "America/Chicago",
  mst: "America/Denver",  mdt: "America/Denver",
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles",
};
function normalizeStateInput(raw?: string | null) {
  const s = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  return STATE_CODE_FROM_NAME[s] || STATE_CODE_FROM_NAME[s.slice(0, 2)] || "";
}
function zoneFromAnyState(raw?: string | null) {
  const code = normalizeStateInput(raw);
  return (code && CODE_TO_ZONE[code]) || "America/New_York";
}
function extractRequestedISO(textIn: string, state?: string): string | null {
  const text = (textIn || "").trim().toLowerCase();
  if (!text) return null;
  const abbr = Object.keys(TZ_ABBR).find((k) => text.includes(` ${k}`));
  const zone = abbr ? TZ_ABBR[abbr] : zoneFromAnyState(state || "");
  const now = DateTime.now().setZone(zone);
  const timeRe = /(\b\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/;

  if (text.includes("tomorrow")) {
    const m = text.match(timeRe);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      const ap = m[3];
      if (ap) { if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; }
      const dt = now.plus({ days: 1 }).set({ hour: h, minute: min, second: 0, millisecond: 0 });
      return dt.isValid ? dt.toISO() : null;
    }
  }

  const weekdays = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  for (const w of weekdays) {
    if (text.includes(w)) {
      const m = text.match(timeRe);
      if (m) {
        let h = parseInt(m[1], 10);
        const min = m[2] ? parseInt(m[2], 10) : 0;
        const ap = m[3];
        if (ap) { if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; }
        const target = (weekdays.indexOf(w) + 1) % 7 || 7;
        let dt = now;
        while (dt.weekday !== target) dt = dt.plus({ days: 1 });
        dt = dt.set({ hour: h, minute: min, second: 0, millisecond: 0 });
        if (dt <= now) dt = dt.plus({ weeks: 1 });
        return dt.toISO();
      }
    }
  }

  const patterns = [
    /(\b\d{1,2})\/(\d{1,2})\b.*?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
    /(\b\d{1,2})-(\d{1,2})\b.*?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const month = parseInt(m[1], 10), day = parseInt(m[2], 10);
      let h = parseInt(m[3], 10);
      const min = m[4] ? parseInt(m[4], 10) : 0;
      const ap = m[5];
      if (ap) { if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; }
      let dt = DateTime.fromObject({ year: now.year, month, day, hour: h, minute: min, second: 0, millisecond: 0 }, { zone });
      if (dt.isValid && dt < now) dt = dt.plus({ years: 1 });
      return dt.isValid ? dt.toISO() : null;
    }
  }

  const bare = text.match(timeRe);
  if (bare) {
    let h = parseInt(bare[1], 10);
    const min = bare[2] ? parseInt(bare[2], 10) : 0;
    const ap = bare[3];
    if (ap) { if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; }
    const dt = now.set({ hour: h, minute: min, second: 0, millisecond: 0 });
    return dt.isValid ? dt.toISO() : null;
  }
  return null;
}

// --- OpenAI tool schema (function calling)
const tools: any[] = [
  {
    type: "function",
    function: {
      name: "book_appointment",
      description: "Create a calendar event via the CRM booking API.",
      parameters: {
        type: "object",
        properties: {
          agentEmail: { type: "string", description: "Agent email (optional, defaults to session user)" },
          name: { type: "string", description: "Lead full name" },
          phone: { type: "string", description: "Lead phone (US). Any format; backend normalizes." },
          email: { type: "string", description: "Lead email (optional)" },
          time: { type: "string", description: "Desired time. Prefer ISO-8601; natural language ok (e.g., 'tomorrow 3pm')." },
          state: { type: "string", description: "US state (GA or Georgia)" },
          durationMinutes: { type: "number", description: "Default 30" },
          notes: { type: "string", description: "Optional notes" },
        },
        required: ["name", "phone", "time", "state"],
      },
    },
  },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  // Optional session (lets the tool fall back to current agent)
  const session = await getServerSession(req, res, authOptions).catch(() => null as any);
  const sessionAgentEmail = session?.user?.email ? String(session.user.email).toLowerCase() : undefined;

  // Accept either a single message or a running transcript
  const body = (req.body || {}) as { message?: string; messages?: Array<{ from: string; text: string }> };

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  if (Array.isArray(body.messages) && body.messages.length) {
    for (const m of body.messages) {
      if (!m?.text) continue;
      messages.push({ role: m.from === "assistant" ? "assistant" : "user", content: String(m.text) });
    }
  } else if (body.message) {
    messages.push({ role: "user", content: String(body.message) });
  } else {
    return res.status(400).json({ message: "Missing message" });
  }

  try {
    const first = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.4,
    });

    const msg = first.choices?.[0]?.message;
    const toolCalls = (msg?.tool_calls as any[]) || [];

    // If no tool call, return the assistant's text (nudge toward booking)
    if (!toolCalls.length) {
      const reply = (msg?.content || "What day/time works for a quick 10–15 minute call? (e.g., Tue 3:30pm your time)").
        toString().trim();
      return res.status(200).json({ reply });
    }

    // Handle first tool call (guarded for SDK type variance)
    const call = toolCalls[0] as FnToolCall;
    if (!call?.function || call.function.name !== "book_appointment") {
      return res.status(200).json({
        reply:
          "Mind sharing your full name, phone, state, and a date/time that works? I’ll get it booked.",
      });
    }

    // Parse args (supports both `.function.arguments` and any `.arguments`)
    const argsJson =
      call.function.arguments ??
      (typeof (call as any).arguments === "string" ? (call as any).arguments : "{}");

    let args: any = {};
    try { args = JSON.parse(argsJson || "{}"); } catch {}

    const agentEmail = (args.agentEmail || sessionAgentEmail || "").toLowerCase() || undefined;
    const name = String(args.name || "").trim();
    const phone = String(args.phone || "").trim();
    const email = String(args.email || "").trim();
    const state = String(args.state || "").trim();
    let time = String(args.time || "").trim();
    const durationMinutes = Number(args.durationMinutes || 30);
    const notes = String(args.notes || "").trim();

    if (!name || !phone || !state || !time) {
      const reply = "I’m missing a detail or two — could you share your full name, phone, state, and the date/time you prefer?";
      return res.status(200).json({ reply });
    }

    // Convert casual time to ISO based on state TZ
    const iso = extractRequestedISO(time, state);
    if (iso) time = iso;

    // Call your existing booking API
    try {
      const resp = await axios.post(
        `${BASE_URL}/api/google/calendar/book-appointment`,
        {
          agentEmail,
          name,
          phone,
          email,
          time,
          state,
          durationMinutes,
          notes,
        },
        {
          headers: {
            "Content-Type": "application/json",
            ...(INTERNAL_API_TOKEN ? { Authorization: `Bearer ${INTERNAL_API_TOKEN}` } : {}),
          },
          timeout: 15000,
        }
      );

      if (resp.data?.success) {
        const startISO = resp.data?.clientStartISO || time;
        const zone = resp.data?.clientZone || zoneFromAnyState(state);
        const dt = DateTime.fromISO(startISO, { zone });
        const readable = dt.isValid ? `${dt.toFormat("ccc, MMM d 'at' h:mm a")} ${dt.offsetNameShort}` : "the scheduled time";
        const reply = `All set — I’ve got you down for ${readable}. You’ll get a confirmation and reminders by text. If you need to change it, just say RESCHEDULE.`;
        return res.status(200).json({ reply });
      }

      const failMsg = (resp.data?.message || "I couldn’t complete the booking just now. What exact date/time works (e.g., Tue 3:30pm) and what state are you in?");
      return res.status(200).json({ reply: failMsg });
    } catch {
      const reply = `Got it — to lock it in, what exact date/time works for you (e.g., “tomorrow 3:00 pm”) and what state are you in?`;
      return res.status(200).json({ reply });
    }
  } catch (e) {
    console.error("assistants/booking error:", e);
    return res.status(200).json({ reply: "Sorry—something hiccuped. Want to try a time later today or tomorrow afternoon?" });
  }
}
