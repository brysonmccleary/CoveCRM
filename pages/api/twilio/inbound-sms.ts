import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import Message from "@/models/Message";
import twilio, { Twilio } from "twilio";
import { OpenAI } from "openai";
import { getTimezoneFromState } from "@/utils/timezone";
import { DateTime } from "luxon";
import { buffer } from "micro";
import axios from "axios";
import crypto from "crypto";
import {
  sendAppointmentBookedEmail,
  sendLeadReplyNotificationEmail,
  resolveLeadDisplayName,
} from "@/lib/email";
import { initSocket } from "@/lib/socket";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

export const config = { api: { bodyParser: false } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const RAW_BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const SHARED_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || "";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";
const LEAD_ENTRY_PATH = (process.env.APP_LEAD_ENTRY_PATH || "/lead").replace(/\/?$/, "");
const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL ||
  (RAW_BASE_URL ? `${RAW_BASE_URL}/api/twilio/status-callback` : undefined);

const ALLOW_DEV_TWILIO_TEST =
  process.env.ALLOW_LOCAL_TWILIO_TEST === "1" && process.env.NODE_ENV !== "production";

// Human-like delay: 3–4 min; set AI_TEST_MODE=1 for 3–5s while testing
const AI_TEST_MODE = process.env.AI_TEST_MODE === "1";
function humanDelayMs() {
  return AI_TEST_MODE ? 3000 + Math.random() * 2000 : 180000 + Math.random() * 60000;
}

// Outbound duplicate suppression window (hard lock per lead+draft)
const DEDUPE_WINDOW_MS = AI_TEST_MODE ? 15_000 : 10 * 60 * 1000; // 15s test, 10m prod

// ---------- quiet hours (lead-local) ----------
const QUIET_START_HOUR = 21; // 9:00 PM
const QUIET_END_HOUR = 8; // 8:00 AM
const MIN_SCHEDULE_LEAD_MINUTES = 15;

// ---- State normalization + zone resolution ----
const STATE_CODE_FROM_NAME: Record<string, string> = {
  // Eastern
  alabama: "AL", al: "AL", georgia: "GA", ga: "GA", florida: "FL", fl: "FL",
  southcarolina: "SC", sc: "SC", northcarolina: "NC", nc: "NC", virginia: "VA", va: "VA",
  westvirginia: "WV", wv: "WV", maryland: "MD", md: "MD", delaware: "DE", de: "DE",
  districtofcolumbia: "DC", dc: "DC", pennsylvania: "PA", pa: "PA", newyork: "NY", ny: "NY",
  newjersey: "NJ", nj: "NJ", connecticut: "CT", ct: "CT", rhodeisland: "RI", ri: "RI",
  massachusetts: "MA", ma: "MA", vermont: "VT", vt: "VT", newhampshire: "NH", nh: "NH",
  maine: "ME", me: "ME", ohio: "OH", oh: "OH", michigan: "MI", mi: "MI", indiana: "IN", in: "IN",
  kentucky: "KY", ky: "KY", tennessee: "TN", tn: "TN",
  // Central
  illinois: "IL", il: "IL", wisconsin: "WI", wi: "WI", minnesota: "MN", mn: "MN",
  iowa: "IA", ia: "IA", missouri: "MO", mo: "MO", arkansas: "AR", ar: "AR",
  louisiana: "LA", la: "LA", mississippi: "MS", ms: "MS", oklahoma: "OK", ok: "OK",
  kansas: "KS", ks: "KS", nebraska: "NE", ne: "NE", southdakota: "SD", sd: "SD",
  northdakota: "ND", nd: "ND", texas: "TX", tx: "TX",
  // Mountain
  colorado: "CO", co: "CO", newmexico: "NM", nm: "NM", wyoming: "WY", wy: "WY",
  montana: "MT", mt: "MT", utah: "UT", ut: "UT", idaho: "ID", id: "ID", arizona: "AZ", az: "AZ",
  // Pacific
  california: "CA", ca: "CA", oregon: "OR", or: "OR", washington: "WA", wa: "WA", nevada: "NV", nv: "NV",
  // Alaska / Hawaii
  alaska: "AK", ak: "AK", hawaii: "HI", hi: "HI",
};
const CODE_TO_ZONE: Record<string, string> = {
  AL: "America/Chicago", GA: "America/New_York", FL: "America/New_York", SC: "America/New_York",
  NC: "America/New_York", VA: "America/New_York", WV: "America/New_York", MD: "America/New_York",
  DE: "America/New_York", DC: "America/New_York", PA: "America/New_York", NY: "America/New_York",
  NJ: "America/New_York", CT: "America/New_York", RI: "America/New_York", MA: "America/New_York",
  VT: "America/New_York", NH: "America/New_York", ME: "America/New_York", OH: "America/New_York",
  MI: "America/New_York", IN: "America/Indiana/Indianapolis", KY: "America/New_York",
  TN: "America/Chicago",
  // Central
  IL: "America/Chicago", WI: "America/Chicago", MN: "America/Chicago", IA: "America/Chicago",
  MO: "America/Chicago", AR: "America/Chicago", LA: "America/Chicago", MS: "America/Chicago",
  OK: "America/Chicago", KS: "America/Chicago", NE: "America/Chicago", SD: "America/Chicago",
  ND: "America/Chicago", TX: "America/Chicago",
  // Mountain
  CO: "America/Denver", NM: "America/Denver", WY: "America/Denver", MT: "America/Denver",
  UT: "America/Denver", ID: "America/Denver", AZ: "America/Phoenix",
  // Pacific
  CA: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles", NV: "America/Los_Angeles",
  // Alaska / Hawaii
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
};
function normalizeStateInput(raw: string | undefined | null): string {
  const s = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  return STATE_CODE_FROM_NAME[s] || (STATE_CODE_FROM_NAME[s.slice(0, 2)] ? STATE_CODE_FROM_NAME[s.slice(0, 2)] : "");
}
function zoneFromAnyState(raw: string | undefined | null): string | null {
  const code = normalizeStateInput(raw);
  const z = code ? CODE_TO_ZONE[code] || null : null;
  return z || getTimezoneFromState(code || String(raw || "")) || null;
}
function pickLeadZone(lead: any): string {
  const z = zoneFromAnyState(lead?.State) || zoneFromAnyState((lead as any)?.state) || "America/New_York";
  return z;
}
function computeQuietHoursScheduling(zone: string): { isQuiet: boolean; scheduledAt?: Date } {
  const nowLocal = DateTime.now().setZone(zone);
  const hour = nowLocal.hour;
  const inQuiet = hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
  if (!inQuiet) return { isQuiet: false };

  let target = nowLocal;
  if (hour < QUIET_END_HOUR) target = nowLocal.set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  else target = nowLocal.plus({ days: 1 }).set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });

  const minUtc = DateTime.utc().plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES });
  const targetUtc = target.toUTC();
  const finalTarget = targetUtc < minUtc ? minUtc : targetUtc;
  return { isQuiet: true, scheduledAt: finalTarget.toJSDate() };
}

// ---------- helpers ----------
function isUS(num: string) { return (num || "").startsWith("+1"); }
function normalizeDigits(p: string) { return (p || "").replace(/\D/g, ""); }

function isOptOut(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  const exact = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"];
  const soft = ["remove", "opt out", "do not text", "don't text", "dont text", "no more text", "no more texts", "not interested", "no longer interested"];
  return exact.includes(t) || soft.some((k) => t.includes(k));
}
function isHelp(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  return t === "help" || t.includes("help");
}
function isStart(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  return t === "start" || t === "unstop" || t === "yes";
}
function containsConfirmation(text: string) {
  const t = (text || "").toLowerCase();
  return [
    "that works","works for me","sounds good","sounds great","perfect","let's do","lets do",
    "confirm","confirmed","book it","schedule it","set it","lock it in","we can do","we could do","3 works","works",
  ].some((p) => t.includes(p));
}
function isInfoRequest(text: string): boolean {
  const t = (text || "").toLowerCase();
  const phrases = [
    "send the info","send info","send details","send me info","send me the info",
    "email the info","email me the info","email details","email me details","just email me",
    "text the info","text me the info","text details","text it","can you text it",
    "mail the info","mail me the info","mail details","just send it","can you send it",
    "do you have something you can send","do you have anything you can send","link","website"
  ];
  return phrases.some((p) => t.includes(p));
}

const TZ_ABBR: Record<string, string> = {
  est: "America/New_York", edt: "America/New_York",
  cst: "America/Chicago", cdt: "America/Chicago",
  mst: "America/Denver",  mdt: "America/Denver",
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles",
};

function extractRequestedISO(textIn: string, state?: string): string | null {
  const text = (textIn || "").trim().toLowerCase();
  if (!text) return null;

  const abbr = Object.keys(TZ_ABBR).find((k) => text.includes(` ${k}`));
  const zone = abbr ? TZ_ABBR[abbr] : zoneFromAnyState(state || "") || "America/New_York";
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
        return dt.isValid ? dt.toISO() : null;
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

  const bare = text.match(/(\b\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (bare) {
    let h = parseInt(bare[1], 10);
    const min = bare[2] ? parseInt(bare[2], 10) : 0;
    const ap = bare[3];
    if (ap) { if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; }
    const dt = DateTime.now().setZone(zoneFromAnyState(state || "") || "America/New_York").set({ hour: h, minute: min, second: 0, millisecond: 0 });
    return dt.isValid ? dt.toISO() : null;
  }
  return null;
}

function extractTimeFromLastAI(history: any[], state?: string): string | null {
  const lastAI = [...(history || [])].reverse().find((m: any) => m.type === "ai");
  if (!lastAI?.text) return null;
  return extractRequestedISO(String(lastAI.text), state);
}

// --- LLM helpers (lightweight intent/time extraction)
async function extractIntentAndTimeLLM(input: { text: string; nowISO: string; tz: string; }) {
  const sys = `Extract intent for a brief SMS thread about booking a call.
Return STRICT JSON with keys:
intent: one of [schedule, confirm, reschedule, ask_cost, ask_duration, cancel, smalltalk, unknown]
datetime_text: string|null (eg "tomorrow 3pm")
yesno: "yes"|"no"|"unknown"`;
  const user = `Now: ${input.nowISO} TZ:${input.tz}\nText: "${input.text}"`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });
  let data: any = {};
  try { data = JSON.parse(resp.choices[0].message.content || "{}"); } catch {}
  return {
    intent: (data.intent as string) || "unknown",
    datetime_text: (data.datetime_text as string) || null,
  };
}

function computeContext(drips?: string[]) {
  const d = drips?.[0] || "";
  if (d.includes("mortgage")) return "mortgage protection";
  if (d.includes("veteran")) return "veteran life insurance";
  if (d.includes("iul")) return "retirement income protection";
  if (d.includes("final_expense")) return "final expense insurance";
  return "life insurance services";
}
function historyToChatMessages(history: any[] = []) {
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of history) {
    if (!m?.text) continue;
    if (m.type === "inbound") msgs.push({ role: "user", content: String(m.text) });
    else if (m.type === "ai" || m.type === "outbound") msgs.push({ role: "assistant", content: String(m.text) });
  }
  return msgs.slice(-24);
}
async function generateConversationalReply(opts: {
  lead: any; userEmail: string; context: string; tz: string; inboundText: string; history: any[];
}) {
  const { context, tz, inboundText, history } = opts;

  const banned = [...(history || [])]
    .reverse()
    .filter((m: any) => m?.type === "ai")
    .map((m: any) => (m.text || "").trim())
    .filter(Boolean)
    .slice(0, 5);

  const sys = `
You are a helpful human-like SMS assistant for an insurance agent.
- Speak like a real person texting: friendly, concise, natural (1–2 sentences, ~240 chars max).
- No names/signatures. No links. No emojis.
- You can acknowledge their message briefly (one clause), then pivot toward ${context} and time booking.
- Ask exactly ONE specific follow-up each turn.
- Vary phrasing—avoid repeating any of these: ${banned.join(" | ") || "(none)"}.
- If they ask about cost or time commitment, answer briefly then ask for a time.
- Keep momentum: suggest two choices when helpful (e.g., “later today or tomorrow afternoon?”).
- Local timezone: ${tz}.
`.trim();

  const chat = historyToChatMessages(history);
  chat.push({ role: "user", content: inboundText });

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    top_p: 0.9,
    presence_penalty: 0.5,
    frequency_penalty: 0.7,
    messages: [{ role: "system", content: sys }, ...chat],
  });

  const text = resp.choices?.[0]?.message?.content?.trim() || "";
  if (!text) return "Got it — what time works for a quick call today or tomorrow?";
  return text.replace(/\s+/g, " ").trim();
}
function normalizeWhen(datetimeText: string | null, nowISO: string, tz: string) {
  if (!datetimeText) return null;
  const iso = extractRequestedISO(datetimeText);
  if (iso) return { start: DateTime.fromISO(iso).setZone(tz) };
  return null;
}

/* --------- Trust a previous outbound only if that lead’s phone actually matches this inbound --------- */
function leadPhoneMatches(lead: any, fromDigits: string): boolean {
  if (!lead) return false;
  const cand: string[] = [];
  const push = (v: any) => { if (v) cand.push(normalizeDigits(String(v))); };
  push((lead as any).Phone);
  push((lead as any).phone);
  push((lead as any)["Phone Number"]);
  push((lead as any).PhoneNumber);
  push((lead as any).Mobile);
  push((lead as any).mobile);
  if (Array.isArray((lead as any).phones)) {
    for (const p of (lead as any).phones) push(p?.value);
  }
  const last10 = fromDigits.slice(-10);
  return cand.some(d => d && d.endsWith(last10));
}

/* --------- NEW: single deterministic phone-first resolver with sorting --------- */
async function findLeadByPhoneDeterministic(userEmail: string, fromNumber: string) {
  const fromDigits = normalizeDigits(fromNumber);
  const last10 = fromDigits.slice(-10);
  const plus1 = last10 ? `+1${last10}` : null;
  const anchored = last10 ? new RegExp(`${last10}$`) : null;

  const phoneFields = [
    "Phone", "phone",
    "Phone Number", "PhoneNumber",
    "Mobile", "mobile",
    "phones.value",
  ];

  const or: any[] = [];
  for (const f of phoneFields) {
    or.push({ userEmail, [f]: fromNumber } as any);
    if (plus1) or.push({ userEmail, [f]: plus1 } as any);
    if (anchored) or.push({ userEmail, [f]: anchored } as any);
  }

  if (or.length === 0) return null;

  // Choose the *most recently touched* lead deterministically
  const lead = await Lead.findOne({ $or: or })
    .sort({ updatedAt: -1, lastInboundAt: -1, createdAt: -1, _id: -1 })
    .exec();

  return lead;
}
// ----------------------------------------------------------------------------------------------------------

// ---------- handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed." });

  // Read raw body for signature verification
  const raw = (await buffer(req)).toString();
  const params = new URLSearchParams(raw);

  // Compute exact URL Twilio used (handles www vs apex & proxies)
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const pathOnly = (req.url || "").split("?")[0] || "/api/twilio/inbound-sms";
  const ABS_BASE_URL = host ? `${proto}://${host}` : RAW_BASE_URL || "";
  const absoluteUrl = host ? `${proto}://${host}${pathOnly}` : (RAW_BASE_URL ? `${RAW_BASE_URL}${pathOnly}` : "");

  // Verify Twilio signature (unless dev bypass)
  const signature = (req.headers["x-twilio-signature"] || "") as string;

  // Prod-safe test bypass via Authorization: Bearer INTERNAL_API_TOKEN
  const hasAuthBypass =
    !!INTERNAL_API_TOKEN &&
    typeof req.headers.authorization === "string" &&
    req.headers.authorization === `Bearer ${INTERNAL_API_TOKEN}`;

  const valid = absoluteUrl
    ? twilio.validateRequest(AUTH_TOKEN, signature, absoluteUrl, Object.fromEntries(params as any))
    : false;

  if (!valid) {
    if (ALLOW_DEV_TWILIO_TEST || hasAuthBypass) {
      console.warn("⚠️ Signature bypass enabled for inbound-sms (dev/test).");
    } else {
      console.warn("❌ Invalid Twilio signature on inbound-sms", { absoluteUrl });
      return res.status(403).send("Invalid signature");
    }
  }

  try {
    await mongooseConnect();

    const messageSid = params.get("MessageSid") || params.get("SmsSid") || "";
    const fromNumber = params.get("From") || "";
    const toNumber = params.get("To") || "";
    const body = (params.get("Body") || "").trim();
    const accountSid = params.get("AccountSid") || "";
    const fromServiceSid = params.get("MessagingServiceSid") || "";
    const numMedia = parseInt(params.get("NumMedia") || "0", 10);

    if (!fromNumber || !toNumber) {
      return res.status(200).json({ message: "Missing required fields, acknowledged." });
    }

    // Idempotency: if Twilio retried, don't double-write or double-email
    if (messageSid) {
      const existing = await Message.findOne({ sid: messageSid }).lean().exec();
      if (existing) return res.status(200).json({ message: "Duplicate delivery (sid), acknowledged." });
    }

    console.log(`📥 inbound sid=${messageSid || "n/a"} from=${fromNumber} -> to=${toNumber} text="${body.slice(0, 120)}${body.length > 120 ? "…" : ""}"`);

    // Map to the user by the inbound (owned) number
    const toDigits = normalizeDigits(toNumber);
    const user =
      (await User.findOne({ "numbers.phoneNumber": toNumber })) ||
      (await User.findOne({ "numbers.phoneNumber": `+1${toDigits.slice(-10)}` })) ||
      (await User.findOne({ "numbers.phoneNumber": `+${toDigits}` }));

    if (!user) {
      console.warn("⚠️ No user matched for To number:", toNumber);
      return res.status(200).json({ message: "No user found for this number." });
    }

    // ===================== PHONE-FIRST lead resolution (deterministic) =====================
    const fromDigits = normalizeDigits(fromNumber);
    let lead: any = null;
    let resolvedBy: "lastOutbound" | "phoneMatch" | "autocreate" | "unknown" = "unknown";

    // (A) Prefer last outbound from THIS owned number to THIS caller, only if lead phone actually matches
    const lastOutbound = await Message.findOne({
      userEmail: user.email,
      direction: "outbound",
      from: toNumber, // sent from this owned number
      $or: [{ to: fromNumber }, { to: `+1${fromDigits.slice(-10)}` }, { to: new RegExp(`${fromDigits.slice(-10)}$`) }],
    }).sort({ sentAt: -1, createdAt: -1, _id: -1 });

    if (lastOutbound?.leadId) {
      const viaMsg = await Lead.findById(lastOutbound.leadId);
      if (viaMsg && leadPhoneMatches(viaMsg, fromDigits)) {
        lead = viaMsg;
        resolvedBy = "lastOutbound";
      } else if (viaMsg) {
        console.warn(`↪︎ Ignoring lastOutbound lead (${String(viaMsg._id)}) — lead phone doesn't match inbound ${fromNumber}`);
      }
    }

    // (B) Deterministic phone match across all common fields with sorting
    if (!lead) {
      lead = await findLeadByPhoneDeterministic(user.email, fromNumber);
      if (lead) resolvedBy = "phoneMatch";
    }

    // =====================================================================

    if (!lead) {
      try {
        lead = await Lead.create({
          userEmail: user.email,
          Phone: fromNumber,
          phone: fromNumber,
          "First Name": "SMS",
          "Last Name": "Lead",
          source: "inbound_sms",
          status: "New",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
        resolvedBy = "autocreate";
        console.log("➕ Created minimal lead for inbound:", fromNumber);
      } catch (e) {
        console.warn("⚠️ Failed to auto-create lead:", e);
      }
    }

    if (!lead) {
      return res.status(200).json({ message: "Lead not found/created, acknowledged." });
    }

    console.log(`✅ inbound mapped leadId=${String(lead._id)} by=${resolvedBy} name="${resolveLeadDisplayName(lead, lead.Phone || (lead as any).phone || fromNumber) || "(no name)"}"`);

    const hadDrips = Array.isArray((lead as any).assignedDrips) && (lead as any).assignedDrips.length > 0;

    // ✅ Ensure Socket.IO exists (init if needed)
    let io = (res as any)?.socket?.server?.io;
    try {
      if (!io) {
        io = initSocket(res as any);
        console.log("✅ Socket server initialized inside inbound-sms");
      }
    } catch (e) {
      console.warn("⚠️ Could not init socket server from inbound-sms:", e);
    }

    // Persist inbound message
    await Message.create({
      leadId: lead._id,
      userEmail: user.email,
      direction: "inbound",
      text: body,
      read: false,
      to: toNumber,
      from: fromNumber,
      sid: messageSid || undefined,
      status: "received",
      receivedAt: new Date(),
      accountSid: accountSid || undefined,
      fromServiceSid: fromServiceSid || undefined,
      numMedia: isNaN(numMedia) ? undefined : numMedia,
    });

    // Update lead interaction history
    const inboundEntry = { type: "inbound" as const, text: body || (numMedia ? "[media]" : ""), date: new Date() };
    lead.interactionHistory = lead.interactionHistory || [];
    lead.interactionHistory.push(inboundEntry);
    lead.lastInboundAt = new Date();
    lead.lastInboundBody = body;
    lead.updatedAt = new Date();
    await lead.save();

    if (io) io.to(user.email).emit("message:new", { leadId: lead._id, ...inboundEntry });

    /* ======================= Agent email notify ======================= */
    try {
      const emailEnabled = user?.notifications?.emailOnInboundSMS !== false; // default true
      if (emailEnabled) {
        const leadDisplayName = resolveLeadDisplayName(lead, lead.Phone || (lead as any).phone || fromNumber);
        const snippet = body.length > 60 ? `${body.slice(0, 60)}…` : body;
        const dripTag = hadDrips ? "[drip] " : "";
        const deepLink = `${ABS_BASE_URL}${LEAD_ENTRY_PATH}/${lead._id}`;
        const subjectWho = leadDisplayName || (lead.Phone || (lead as any).phone || fromNumber);

        await sendLeadReplyNotificationEmail({
          to: user.email,
          replyTo: user.email, // reply-to agent
          subject: `[New Lead Reply] ${dripTag}${subjectWho} — ${snippet || "(no text)"}`,
          leadName: leadDisplayName || undefined,
          leadPhone: lead.Phone || (lead as any).phone || fromNumber,
          leadEmail: lead.Email || (lead as any).email || "",
          folder: (lead as any).folder || (lead as any).Folder || (lead as any)["Folder Name"],
          status: (lead as any).status || (lead as any).Status,
          message: body || (numMedia ? "[media]" : ""),
          receivedAtISO: new Date().toISOString(),
          linkUrl: deepLink,
        });
      }
    } catch (e) {
      console.warn("⚠️ Inbound reply email failed (non-fatal):", (e as any)?.message || e);
    }

    // === Keyword handling (no auto-reply here, just flags) ===
    if (isOptOut(body)) {
      lead.assignedDrips = [];
      (lead as any).dripProgress = [];
      lead.isAIEngaged = false;
      (lead as any).unsubscribed = true;
      (lead as any).optOut = true;
      (lead as any).status = "Not Interested";

      const note = { type: "system" as const, text: "[system] Lead opted out — moved to Not Interested.", date: new Date() };
      lead.interactionHistory.push(note);
      await lead.save();

      if (io) {
        io.to(user.email).emit("lead:updated", {
          _id: lead._id,
          status: "Not Interested",
          unsubscribed: true,
          optOut: true,
        });
        io.to(user.email).emit("message:new", { leadId: lead._id, ...note });
      }

      console.log("🚫 Opt-out set & moved to Not Interested for", fromNumber);
      return res.status(200).json({ message: "Lead opted out; moved to Not Interested." });
    }

    if (isHelp(body)) {
      const note = { type: "system" as const, text: "[system] HELP detected.", date: new Date() };
      lead.interactionHistory.push(note);
      await lead.save();
      if (io) io.to(user.email).emit("message:new", { leadId: lead._id, ...note });
      return res.status(200).json({ message: "Help handled (no auto-reply)." });
    }

    if (isStart(body)) {
      (lead as any).unsubscribed = false;
      (lead as any).optOut = false;
      const note = { type: "system" as const, text: "[system] START/UNSTOP detected — lead opted back in.", date: new Date() };
      lead.interactionHistory.push(note);
      await lead.save();
      if (io) io.to(user.email).emit("message:new", { leadId: lead._id, ...note });
      console.log("🔓 Opt-in restored for", fromNumber);
      return res.status(200).json({ message: "Start handled." });
    }

    // A2P gate (shared MS counts as approved)
    const a2p = await A2PProfile.findOne({ userId: String(user._id) });
    const usConversation = isUS(fromNumber) || isUS(toNumber);
    const approved = SHARED_MESSAGING_SERVICE_SID || (a2p?.messagingReady && a2p?.messagingServiceSid);
    if (usConversation && !approved) {
      const note = { type: "system" as const, text: "[note] Auto-reply suppressed: A2P not approved yet.", date: new Date() };
      lead.interactionHistory.push(note);
      await lead.save();
      if (io) io.to(user.email).emit("message:new", { leadId: lead._id, ...note });
      console.warn("⚠️ Auto-reply suppressed (A2P not approved)");
      return res.status(200).json({ message: "A2P not approved; no auto-reply sent." });
    }

    if ((lead as any).unsubscribed || (lead as any).optOut) {
      console.log("⛔ Lead marked unsubscribed/optOut — skipping auto-reply.");
      return res.status(200).json({ message: "Lead unsubscribed; no auto-reply." });
    }

    // Do not engage AI for retention campaigns
    const assignedDrips = (lead as any).assignedDrips || [];
    const isClientRetention = (assignedDrips as any[]).some((id: any) => typeof id === "string" && id.includes("client_retention"));
    if (isClientRetention) return res.status(200).json({ message: "Client retention reply — no AI engagement." });

    // ✅ Cancel drips & engage AI
    lead.assignedDrips = [];
    (lead as any).dripProgress = [];
    lead.isAIEngaged = true;

    const tz = pickLeadZone(lead);
    const nowISO = DateTime.utc().toISO();
    type ConvState = "idle" | "awaiting_time" | "scheduled" | "qa";
    interface LeadMemory {
      state: ConvState;
      lastAsked?: string[];
      apptISO?: string | null;
      apptText?: string | null;
      tz?: string;
      lastConfirmAtISO?: string | null;
      lastDraft?: string | null;
    }
    const memory: LeadMemory = {
      state: ((lead as any).aiMemory?.state as ConvState) || "idle",
      lastAsked: (lead as any).aiMemory?.lastAsked || [],
      apptISO: (lead as any).aiMemory?.apptISO || null,
      apptText: (lead as any).aiMemory?.apptText || null,
      tz,
      lastConfirmAtISO: (lead as any).aiMemory?.lastConfirmAtISO || null,
      lastDraft: (lead as any).aiMemory?.lastDraft || null,
    };

    // ===== decide next reply =====
    let aiReply = "When’s a good time today or tomorrow for a quick chat?";
    const stateCanon = normalizeStateInput(lead.State || (lead as any).state || "");

    // 1) deterministic parse
    let requestedISO: string | null = extractRequestedISO(body, stateCanon);
    // 2) confirmation binds to last AI proposal
    if (!requestedISO && containsConfirmation(body)) {
      requestedISO =
        extractTimeFromLastAI(lead.interactionHistory || [], stateCanon) ||
        (lead as any).aiLastProposedISO ||
        null;
    }

    // 2.5) explicit info-request → canned line
    if (!requestedISO && isInfoRequest(body)) {
      aiReply = `Unfortunately as of now there's nothing to send over without getting some information from you. When's a good time for a quick 5 minute call? After that we can send everything out.`;
      memory.state = "qa";
    }

    // 3) conversational fallback
    if (!requestedISO && !isInfoRequest(body)) {
      try {
        const ex = await extractIntentAndTimeLLM({ text: body, nowISO, tz });
        const norm = normalizeWhen(ex.datetime_text, nowISO, tz);
        if (norm?.start) requestedISO = norm.start.toISO();

        if (!requestedISO) {
          const context = computeContext(lead.assignedDrips);
          if (ex.intent === "ask_duration") {
            aiReply = `It’s quick—about 10–15 minutes. Would later today or tomorrow afternoon work?`;
            memory.state = "qa";
          } else if (ex.intent === "ask_cost") {
            aiReply = `No cost at all—just a quick review of options. What’s better for you, today or tomorrow?`;
            memory.state = "qa";
          } else {
            aiReply = await generateConversationalReply({
              lead,
              userEmail: user.email,
              context,
              tz,
              inboundText: body,
              history: lead.interactionHistory || [],
            });
            const askedRecently = (memory.lastAsked || []).includes("chat_followup");
            if (!askedRecently) memory.lastAsked = [...(memory.lastAsked || []).slice(-1), "chat_followup"];
            memory.state = "awaiting_time";
          }
        }
      } catch {
        memory.state = "awaiting_time";
        const lastAI = [...(lead.interactionHistory || [])].reverse().find((m: any) => m.type === "ai");
        const v = `What time works for you—today or tomorrow? You can reply like “tomorrow 3:00 pm”.`;
        aiReply = lastAI?.text?.trim() === v
          ? `Shoot me a time that works (e.g., “tomorrow 3:00 pm”) and I’ll text a confirmation.`
          : v;
      }
    }

    // 4) If we have a concrete time now, confirm + book
    if (requestedISO) {
      const zone = tz;
      const clientTime = DateTime.fromISO(requestedISO, { zone }).set({ second: 0, millisecond: 0 });

      const alreadyConfirmedSame =
        (lead as any).aiLastConfirmedISO &&
        DateTime.fromISO((lead as any).aiLastConfirmedISO).toISO() === clientTime.toISO();

      if (alreadyConfirmedSame) {
        aiReply = `All set — you’re on my schedule. Talk soon!`;
      } else {
        try {
          const bookingPayload = {
            agentEmail: (lead.userEmail || user.email || "").toLowerCase(),
            name: resolveLeadDisplayName(lead) || "Client",
            phone: lead.Phone || (lead as any).phone || fromNumber,
            email: lead.Email || (lead as any).email || "",
            time: clientTime.toISO(),
            state: stateCanon || "AZ",
            durationMinutes: 30,
            notes: "Auto-booked via inbound SMS",
          };
          const bookingRes = await axios.post(
            `${RAW_BASE_URL || ABS_BASE_URL}/api/google/calendar/book-appointment`,
            { ...bookingPayload },
            {
              headers: { Authorization: `Bearer ${INTERNAL_API_TOKEN}`, "Content-Type": "application/json" },
              timeout: 15000,
            },
          );

          if ((bookingRes.data || {}).success) {
            (lead as any).status = "Booked";
            (lead as any).appointmentTime = clientTime.toJSDate();

            try {
              const fullName = resolveLeadDisplayName(lead, lead.Phone || (lead as any).phone || fromNumber);
              await sendAppointmentBookedEmail({
                to: (lead.userEmail || user.email || "").toLowerCase(),
                agentName: (user as any)?.name || user.email,
                leadName: fullName,
                phone: lead.Phone || (lead as any).phone || fromNumber,
                state: stateCanon || "",
                timeISO: clientTime.toISO()!,
                timezone: clientTime.offsetNameShort || undefined,
                source: "AI",
                eventUrl: (bookingRes.data?.event?.htmlLink || bookingRes.data?.htmlLink || "") as string | undefined,
              });
            } catch (e) {
              console.warn("Email send failed (appointment):", e);
            }
          } else {
            console.warn("⚠️ Booking API responded but not success:", bookingRes.data);
          }
        } catch (e) {
          console.error("⚠️ Booking API failed (proceeding to confirm by SMS):", (e as any)?.response?.data || e);
        }

        const readable = clientTime.toFormat("ccc, MMM d 'at' h:mm a");
        aiReply = `Perfect — I’ve got you down for ${readable} ${clientTime.offsetNameShort}. You’ll get a confirmation shortly. Reply RESCHEDULE if you need to change it.`;
        (lead as any).aiLastConfirmedISO = clientTime.toISO();
        (lead as any).aiLastProposedISO = clientTime.toISO();
        memory.state = "scheduled";
        memory.apptISO = clientTime.toISO();
        memory.apptText = requestedISO;
        memory.lastConfirmAtISO = DateTime.utc().toISO();
      }
    }

    memory.lastDraft = aiReply;

    (lead as any).aiMemory = memory;
    lead.aiLastResponseAt = new Date();
    await lead.save();

    // Delayed AI reply (human-like), force FROM the exact inbound number
    setTimeout(async () => {
      try {
        await mongooseConnect();

        const fresh = await Lead.findById(lead._id);
        if (!fresh) return;

        // Cool-down: don't spam if we just responded
        if (fresh.aiLastResponseAt && Date.now() - new Date(fresh.aiLastResponseAt).getTime() < 2 * 60 * 1000) {
          console.log("⏳ Skipping AI reply (cool-down).");
          return;
        }
        if ((fresh as any).appointmentTime && !(fresh as any).aiLastConfirmedISO) {
          console.log("✅ Appointment already set; skipping nudge.");
          return;
        }

        const lastAI = [...(fresh.interactionHistory || [])].reverse().find((m: any) => m.type === "ai");
        const draft = ((fresh as any).aiMemory?.lastDraft as string) || "When’s a good time today or tomorrow for a quick chat?";

        // Plain-text repeat guard
        if (lastAI && lastAI.text?.trim() === draft.trim()) {
          console.log("🔁 Same AI content as last time — not sending.");
          return;
        }

        // **Hard dedupe**: per-lead lock on same draft within window
        const key = `${user.email}|${fresh._id}|${toNumber}|${fromNumber}|${draft}`;
        const keyHash = crypto.createHash("sha1").update(key).digest("hex");
        const threshold = new Date(Date.now() - DEDUPE_WINDOW_MS);

        const lockOk = await Lead.findOneAndUpdate(
          {
            _id: fresh._id,
            $or: [
              { "aiSendLock.at": { $lt: threshold } },
              { "aiSendLock.key": { $ne: keyHash } },
              { aiSendLock: { $exists: false } },
            ],
          },
          { $set: { aiSendLock: { key: keyHash, at: new Date() } } },
          { new: true, upsert: false }
        );
        if (!lockOk) {
          console.log("🛑 Duplicate send blocked by lead lock.");
          return;
        }

        // Extra safety: recent identical outbound exists?
        const recentDupe = await Message.findOne({
          userEmail: user.email,
          leadId: fresh._id,
          direction: { $in: ["outbound", "ai"] },
          text: draft,
          to: fromNumber,
          from: toNumber,
          createdAt: { $gt: threshold },
        }).lean();
        if (recentDupe) {
          console.log("🛑 Duplicate send blocked by recent message check.");
          return;
        }

        const zone = pickLeadZone(fresh);
        const { isQuiet, scheduledAt } = computeQuietHoursScheduling(zone);

        const baseParams = await getSendParams(String(user._id), toNumber, fromNumber, { forceFrom: toNumber });
        const paramsOut: Parameters<Twilio["messages"]["create"]>[0] = { ...baseParams, body: draft };

        const canSchedule = "messagingServiceSid" in paramsOut;
        if (isQuiet && scheduledAt && canSchedule) {
          (paramsOut as any).scheduleType = "fixed";
          (paramsOut as any).sendAt = scheduledAt.toISOString();
        } else if (isQuiet && !canSchedule) {
          console.warn("⚠️ Quiet hours but cannot schedule when forcing a single From number. Sending immediately.");
        }

        const aiEntry = { type: "ai" as const, text: draft, date: new Date() };
        fresh.interactionHistory = fresh.interactionHistory || [];
        fresh.interactionHistory.push(aiEntry);
        fresh.aiLastResponseAt = new Date();
        await fresh.save();

        const { client } = await getClientForUser(user.email);
        const twilioMsg = await client.messages.create(paramsOut);

        await Message.create({
          leadId: fresh._id,
          userEmail: user.email,
          direction: "outbound",
          text: draft,
          read: true,
          to: fromNumber,
          from: toNumber,
          sid: (twilioMsg as any)?.sid,
          status: (twilioMsg as any)?.status,
          sentAt: isQuiet && scheduledAt && canSchedule ? scheduledAt : new Date(),
          fromServiceSid: (paramsOut as any).messagingServiceSid,
        });

        if (io) io.to(user.email).emit("message:new", { leadId: fresh._id, ...aiEntry });

        if (isQuiet && scheduledAt && canSchedule) {
          console.log(`🕘 Quiet hours: scheduled AI reply to ${fromNumber} at ${scheduledAt.toISOString()} (${zone}) | SID: ${(twilioMsg as any)?.sid}`);
        } else {
          console.log(`🤖 AI reply sent to ${fromNumber} FROM ${toNumber} | SID: ${(twilioMsg as any)?.sid}`);
        }
      } catch (err) {
        console.error("❌ Delayed send failed:", err);
      }
    }, humanDelayMs());

    return res.status(200).json({ message: "Inbound received; AI reply scheduled." });
  } catch (error: any) {
    console.error("❌ SMS handler failed:", error);
    return res.status(200).json({ message: "Inbound SMS handled with internal error." });
  }
}

/** Prefer shared Messaging Service if present; else tenant MS; else direct from. */
async function getSendParams(
  userId: string,
  toNumber: string,
  fromNumber: string,
  opts?: { forceFrom?: string }
) {
  const base: any = { statusCallback: STATUS_CALLBACK };

  if (opts?.forceFrom) {
    return {
      ...base,
      from: opts.forceFrom,
      to: fromNumber,
    } as Parameters<Twilio["messages"]["create"]>[0];
  }

  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    return {
      ...base,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      to: fromNumber,
    } as Parameters<Twilio["messages"]["create"]>[0];
  }

  const a2p = await A2PProfile.findOne({ userId });
  if (a2p?.messagingServiceSid) {
    return {
      ...base,
      messagingServiceSid: a2p.messagingServiceSid,
      to: fromNumber,
    } as Parameters<Twilio["messages"]["create"]>[0];
  }

  return {
    ...base,
    from: toNumber,
    to: fromNumber,
  } as Parameters<Twilio["messages"]["create"]>[0];
}
