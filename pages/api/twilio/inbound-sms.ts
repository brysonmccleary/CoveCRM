// /pages/api/twilio/inbound-sms.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import Message from "@/models/Message";
import DripEnrollment from "@/models/DripEnrollment"; // ✅ for auto-pause on reply
import twilio, { Twilio } from "twilio";
import { OpenAI } from "openai";
import { getTimezoneFromState } from "@/utils/timezone";
import { DateTime } from "luxon";
import { buffer } from "micro";
import axios from "axios";
import {
  sendAppointmentBookedEmail,
  sendLeadReplyNotificationEmail,
  resolveLeadDisplayName,
} from "@/lib/email";
import { initSocket } from "@/lib/socket";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

// ✅ Billing imports
import { trackUsage } from "@/lib/billing/trackUsage";
import { priceOpenAIUsage } from "@/lib/billing/openaiPricing";
import { estimateSmsChargeUSD } from "@/lib/billing/smsPricing";

export const config = { api: { bodyParser: false } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const RAW_BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const SHARED_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || "";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";
const LEAD_ENTRY_PATH = (process.env.APP_LEAD_ENTRY_PATH || "/lead").replace(/\/?$/, "");
const BUILD_TAG = "inbound-sms@2025-10-22T17:00Z";
console.log(`[inbound-sms] build=${BUILD_TAG}`);

const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL ||
  (RAW_BASE_URL ? `${RAW_BASE_URL}/api/twilio/status-callback` : undefined);

const ALLOW_DEV_TWILIO_TEST =
  process.env.ALLOW_LOCAL_TWILIO_TEST === "1" && process.env.NODE_ENV !== "production";

// Whether to add separate OpenAI line items (default OFF; SMS covers it)
const BILL_OPENAI_SEPARATELY = (process.env.BILL_OPENAI_SEPARATELY || "0") !== "0";

// Human delay: 3–4 min; set AI_TEST_MODE=1 for 3–5s while testing
const AI_TEST_MODE = process.env.AI_TEST_MODE === "1";
function humanDelayMs() {
  return AI_TEST_MODE ? 3000 + Math.random() * 2000 : 180000 + Math.random() * 60000;
}

// Env-driven cooldown (seconds). Test: 0. Prod: 120 recommended.
const AI_COOLDOWN_SECONDS = Number.isFinite(parseInt(process.env.AI_COOLDOWN_SECONDS || "", 10))
  ? parseInt(process.env.AI_COOLDOWN_SECONDS || "120", 10)
  : 120;

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
  return (
    STATE_CODE_FROM_NAME[s] ||
    (STATE_CODE_FROM_NAME[s.slice(0, 2)]
      ? STATE_CODE_FROM_NAME[s.slice(0, 2)]
      : "")
  );
}

function zoneFromAnyState(raw: string | undefined | null): string | null {
  const code = normalizeStateInput(raw);
  const z = code ? CODE_TO_ZONE[code] || null : null;
  return z || getTimezoneFromState(code || String(raw || "")) || null;
}

function pickLeadZone(lead: any): string {
  const z =
    zoneFromAnyState(lead?.State) ||
    zoneFromAnyState((lead as any)?.state) ||
    "America/New_York";
  return z;
}

function computeQuietHoursScheduling(zone: string): {
  isQuiet: boolean;
  scheduledAt?: Date;
} {
  const nowLocal = DateTime.now().setZone(zone);
  const hour = nowLocal.hour;
  const inQuiet = hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
  if (!inQuiet) return { isQuiet: false };

  let target = nowLocal;
  if (hour < QUIET_END_HOUR) {
    target = nowLocal.set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  } else {
    target = nowLocal.plus({ days: 1 }).set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  }

  const minUtc = DateTime.utc().plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES });
  const targetUtc = target.toUTC();
  const finalTarget = targetUtc < minUtc ? minUtc : targetUtc;
  return { isQuiet: true, scheduledAt: finalTarget.toJSDate() };
}

// ---------- helpers ----------
function isUS(num: string) {
  return (num || "").startsWith("+1");
}
function normalizeDigits(p: string) {
  return (p || "").replace(/\D/g, "");
}

// Tone enforcement helpers
function stripUrls(s: string) {
  // remove http/https/www links
  return s.replace(/\b(?:https?:\/\/|www\.)\S+\b/gi, "");
}
function stripEmojis(s: string) {
  // remove most emoji symbols
  return s.replace(
    /([\u2700-\u27BF]|[\uE000-\uF8FF]|[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u26FF])/g,
    ""
  );
}
function limitSentences(s: string, maxSentences = 2) {
  const parts = s.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return parts.slice(0, maxSentences).join(" ").trim();
}
function sanitizeSMS(s: string) {
  const cleaned = limitSentences(stripEmojis(stripUrls(s)), 2).trim();
  return cleaned.length > 240 ? cleaned.slice(0, 240).trim() : cleaned;
}

function isOptOut(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  const exact = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"];
  const soft = [
    "remove",
    "opt out",
    "do not text",
    "don't text",
    "dont text",
    "no more text",
    "no more texts",
    "not interested",
    "no longer interested",
  ];
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
    "that works",
    "works for me",
    "sounds good",
    "sounds great",
    "perfect",
    "let's do",
    "lets do",
    "confirm",
    "confirmed",
    "book it",
    "schedule it",
    "set it",
    "lock it in",
    "we can do",
    "we could do",
    "3 works",
    "works",
  ].some((p) => t.includes(p));
}
function isInfoRequest(text: string): boolean {
  const t = (text || "").toLowerCase();
  const phrases = [
    "send the info",
    "send info",
    "send details",
    "send me info",
    "send me the info",
    "email the info",
    "email me the info",
    "email details",
    "email me details",
    "just email me",
    "text the info",
    "text me the info",
    "text details",
    "text it",
    "can you text it",
    "mail the info",
    "mail me the info",
    "mail details",
    "just send it",
    "can you send it",
    "do you have something you can send",
    "do you have anything you can send",
    "link",
    "website",
  ];
  return phrases.some((p) => t.includes(p));
}

const TZ_ABBR: Record<string, string> = {
  est: "America/New_York",
  edt: "America/New_York",
  cst: "America/Chicago",
  cdt: "America/Chicago",
  mst: "America/Denver",
  mdt: "America/Denver",
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
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
      if (ap) {
        if (ap === "pm" && h < 12) h += 12;
        if (ap === "am" && h === 12) h = 0;
      }
      const dt = now
        .plus({ days: 1 })
        .set({ hour: h, minute: min, second: 0, millisecond: 0 });
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
        if (ap) {
          if (ap === "pm" && h < 12) h += 12;
          if (ap === "am" && h === 12) h = 0;
        }
        const target = ((weekdays.indexOf(w) + 1) % 7) || 7;
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
      const month = parseInt(m[1], 10),
        day = parseInt(m[2], 10);
      let h = parseInt(m[3], 10);
      const min = parseInt(m[4], 10) || 0;
      const ap = m[5];
      if (ap) {
        if (ap === "pm" && h < 12) h += 12;
        if (ap === "am" && h === 12) h = 0;
      }
      let dt = DateTime.fromObject(
        { year: now.year, month, day, hour: h, minute: min, second: 0, millisecond: 0 },
        { zone },
      );
      if (dt.isValid && dt < now) dt = dt.plus({ years: 1 });
      return dt.isValid ? dt.toISO() : null;
    }
  }

  const bare = text.match(/(\b\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (bare) {
    let h = parseInt(bare[1], 10);
    const min = bare[2] ? parseInt(bare[2], 10) : 0;
    const ap = bare[3];
    if (ap) {
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
    }
    const dt = DateTime.now()
      .setZone(zoneFromAnyState(state || "") || "America/New_York")
      .set({ hour: h, minute: min, second: 0, millisecond: 0 });
    return dt.isValid ? dt.toISO() : null;
  }
  return null;
}

function extractTimeFromLastAI(history: any[], state?: string): string | null {
  const lastAI = [...(history || [])].reverse().find((m: any) => m.type === "ai");
  if (!lastAI?.text) return null;
  return extractRequestedISO(String(lastAI.text), state);
}

function computeContext(drips?: string[]) {
  const d = drips?.[0] || "";
  if (d.includes("mortgage")) return "mortgage protection";
  if (d.includes("veteran")) return "veteran life insurance";
  if (d.includes("iul")) return "retirement income protection";
  if (d.includes("final_expense")) return "final expense insurance";
  return "life insurance and mortgage protection";
}

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
function askedRecently(memory: LeadMemory, key: string) {
  const hay = memory.lastAsked || [];
  return hay.includes(key);
}
function pushAsked(memory: LeadMemory, key: string) {
  const arr = (memory.lastAsked || []).slice(-1);
  arr.push(key);
  memory.lastAsked = arr;
}

// ===== Minimal module-level scratch to know which user to bill for OpenAI usage
let _lastInboundUserEmailForBilling: string | null = null;

// --- LLM helpers
async function extractIntentAndTimeLLM(input: { text: string; nowISO: string; tz: string }) {
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

  // ✅ Bill OpenAI usage
  try {
    const usage = (resp as any)?.usage || {};
    const raw = priceOpenAIUsage({
      model: "gpt-4o-mini",
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
    });
    if (BILL_OPENAI_SEPARATELY && raw > 0 && _lastInboundUserEmailForBilling) {
      await trackUsage({
        user: { email: _lastInboundUserEmailForBilling },
        amount: raw,
        source: "openai",
      });
    }
  } catch {}

  let data: any = {};
  try {
    data = JSON.parse(resp.choices[0].message.content || "{}");
  } catch {}
  return {
    intent: (data.intent as string) || "unknown",
    datetime_text: (data.datetime_text as string) || null,
  };
}

// --- chat history for LLM (user/assistant roles)
function historyToChatMessages(history: any[] = []) {
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of history) {
    if (!m?.text) continue;
    if (m.type === "inbound") msgs.push({ role: "user", content: String(m.text) });
    else if (m.type === "ai" || m.type === "outbound")
      msgs.push({ role: "assistant", content: String(m.text) });
  }
  return msgs.slice(-24);
}

// --- Deterministic matcher (pattern -> reply)
function buildDeterministicReply(textRaw: string, context: string): string | null {
  const t = (textRaw || "").trim().toLowerCase();
  const any = (...subs: string[]) => subs.some(s => t.includes(s));

  // 1) Already have coverage
  if (any("already have coverage", "i already have", "i'm covered", "im covered", "we're covered", "we are covered", "we’re covered", "already insured", "have life insurance", "have insurance already")) {
    return "I can see that on my end, it looks like we can save you anywhere from $20-$50+ a month. When do you have five minutes to talk?";
    // short, 1–2 sentences, no links/emojis
  }

  // 2) Not interested (non-STOP)
  if (any("not interested", "no thanks", "no thank you", "pass", "stop texting") && !["stop","stopall","unsubscribe","cancel","end","quit"].includes(t)) {
    return "Totally get it. Before I close it out, most folks still find $20–$50+ in savings in a 5-min check. Want me to hold a quick time later today or tomorrow?";
  }

  // 3) Price / cost
  if (any("how much", "price", "rate", "rates", "cost", "quote")) {
    return "Good question. Your exact monthly depends on a couple quick details—takes about 5 minutes. What time works later today or tomorrow for a quick call?";
  }

  // 4) Busy / later
  if (any("busy", "can’t talk", "cant talk", "in a meeting", "later", "another time", "driving")) {
    return "No problem—I’ll keep it to 5 minutes. What’s a quick window later today or tomorrow?";
  }

  // 5) Who is this / how got number
  if (any("who is this", "who are you", "how did you get my number", "what company", "is this legit", "scam")) {
    return "Hey there—this is the benefits team that handles life insurance and mortgage protection requests you asked about. It’s a quick 5-min review. What time works today or tomorrow?";
  }

  // 6) Remove me / wrong number (non-STOP phrasing)
  if (any("remove me", "wrong number", "dont text", "don't text", "do not text")) {
    return "Understood—I’ll update that. If you’re comparing options, we can check in 5 minutes. Want a quick time later today or tomorrow?";
  }

  // 7) Send info
  if (any("send info", "send the info", "send details", "email me", "text me info", "mail the info", "just send it", "can you send it", "link", "website")) {
    return "Unfortunately as of now there's nothing to send over without getting some information from you. When's a good time for a quick 5 minute call? After that we can send everything out.";
  }

  // 8) Already talked / my agent / already applied
  if (any("already talked", "already applied", "my agent", "have an agent", "working with an agent")) {
    return "Makes sense—this will be quick. We usually find $20–$50+ a month by checking carriers they didn’t quote. Want a fast 5-min look later today or tomorrow?";
  }

  // 9) Health / don’t qualify
  if (any("don’t qualify", "dont qualify", "declined", "pre-existing", "preexisting", "health issues")) {
    return "Some carriers are flexible on health—often people still qualify. Let’s take 5 minutes and check. What time works today or tomorrow?";
  }

  // 10) Age
  if (any("too old", "too young", "age")) {
    return "Age changes which carriers fit best, but there are options. A quick 5-min check answers it. What time works today or tomorrow?";
  }

  // 11) Cheapest only
  if (any("cheapest", "lowest price", "best rate")) {
    return "Got it—let’s run a fast apples-to-apples check for the lowest monthly. Takes about 5 minutes. What time works later today or tomorrow?";
  }

  // 12) Text only
  if (any("text only", "don’t call", "dont call", "can we text")) {
    return "We can text basics, but final numbers need a quick verbal to be accurate—it’s 5 minutes. What time works later today or tomorrow?";
  }

  // 13) Tomorrow explicit
  if (any("tomorrow")) {
    return "Sounds good—what’s a quick 5-10 minute window tomorrow?";
  }

  // 14) Time/call length
  if (any("how long", "time does it take", "length of call")) {
    return "About 5 minutes to see exact monthly and options. What time works today or tomorrow?";
  }

  // 15) Spanish / español
  if (/[áéíóúñ]|hablas|espanol|español/.test(t)) {
    return "¡Sí! Podemos revisarlo en 5 minutos y ver si bajamos su pago $20–$50+ al mes. ¿Prefiere hoy o mañana para una llamada rápida?";
  }

  // 16) Profanity / hostile (non-STOP)
  if (/\b(fuck|idiot|stupid|scam|bs|b\s*s)\b/i.test(textRaw) && !isOptOut(textRaw)) {
    return "I hear you. If you want a real number later, it’s a quick 5-minute review and often saves $20–$50+ a month. What time works today or tomorrow?";
  }

  // Default: null → let LLM fallback handle it
  return null;
}

// --- conversational reply (LLM fallback)
async function generateConversationalReply(opts: {
  lead: any;
  userEmail: string;
  context: string;
  tz: string;
  inboundText: string;
  history: any[];
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

  // ✅ Bill OpenAI usage
  try {
    const usage = (resp as any)?.usage || {};
    const raw = priceOpenAIUsage({
      model: "gpt-4o-mini",
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
    });
    if (BILL_OPENAI_SEPARATELY && raw > 0 && _lastInboundUserEmailForBilling) {
      await trackUsage({
        user: { email: _lastInboundUserEmailForBilling },
        amount: raw,
        source: "openai",
      });
    }
  } catch {}

  const text = resp.choices?.[0]?.message?.content?.trim() || "";
  if (!text) return "Got it — what time works for a quick call today or tomorrow?";
  return sanitizeSMS(text);
}

function normalizeWhen(datetimeText: string | null, nowISO: string, tz: string) {
  if (!datetimeText) return null;
  const iso = extractRequestedISO(datetimeText);
  if (iso) return { start: DateTime.fromISO(iso).setZone(tz) };
  return null;
}

/* --------- Only trust a previous outbound if that lead’s phone actually matches this inbound --------- */
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
  return cand.some((d) => d && d.endsWith(last10));
}
// ----------------------------------------------------------------------------------------------------------

// ---------- handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed." });

  // Read raw body for signature verification
  const raw = (await buffer(req)).toString();
  const params = new URLSearchParams(raw);

  // Compute exact URL Twilio used (handles www vs apex & proxies)
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const pathOnly = (req.url || "").split("?")[0] || "/api/twilio/inbound-sms";
  const ABS_BASE_URL = host ? `${proto}://${host}` : RAW_BASE_URL || "";
  const absoluteUrl = host ? `${proto}://${host}${pathOnly}` : RAW_BASE_URL ? `${RAW_BASE_URL}${pathOnly}` : "";

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

    // Idempotency
    if (messageSid) {
      const existing = await Message.findOne({ sid: messageSid }).lean().exec();
      if (existing) {
        return res.status(200).json({ message: "Duplicate delivery (sid), acknowledged." });
      }
    }

    console.log(
      `📥 inbound sid=${messageSid || "n/a"} from=${fromNumber} -> to=${toNumber} text="${body.slice(0, 120)}${body.length > 120 ? "…" : ""}"`
    );

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

    // Set billing context for OpenAI
    _lastInboundUserEmailForBilling = (user.email || "").toLowerCase();

    // ===================== Lead resolution =====================
    const fromDigits = normalizeDigits(fromNumber);
    const last10 = fromDigits.slice(-10);
    const anchored = last10 ? new RegExp(`${last10}$`) : undefined;

    let lead: any = null;

    // (A) Consider last outbound ONLY if that lead’s saved phone matches this inbound
    const lastOutbound = await Message.findOne({
      userEmail: user.email,
      direction: "outbound",
      from: toNumber,
      $or: [{ to: fromNumber }, { to: `+1${last10}` }, ...(anchored ? [{ to: anchored }] : [])],
    }).sort({ sentAt: -1, createdAt: -1, _id: -1 });

    if (lastOutbound?.leadId) {
      const viaMsg = await Lead.findById(lastOutbound.leadId);
      if (viaMsg && leadPhoneMatches(viaMsg, fromDigits)) {
        lead = viaMsg;
      } else if (viaMsg) {
        console.warn(
          `↪︎ Ignoring lastOutbound lead (${String(viaMsg._id)}) — phone on lead does not match inbound ${fromNumber}`,
        );
      }
    }

    // (B) Exact E.164 match on common fields
    if (!lead) {
      lead =
        (await Lead.findOne({ userEmail: user.email, Phone: fromNumber })) ||
        (await Lead.findOne({ userEmail: user.email, phone: fromNumber })) ||
        (await Lead.findOne({ userEmail: user.email, ["Phone Number"]: fromNumber } as any)) ||
        (await Lead.findOne({ userEmail: user.email, PhoneNumber: fromNumber } as any)) ||
        (await Lead.findOne({ userEmail: user.email, Mobile: fromNumber } as any)) ||
        (await Lead.findOne({ userEmail: user.email, mobile: fromNumber } as any)) ||
        (await Lead.findOne({ userEmail: user.email, "phones.value": fromNumber } as any));
    }

    // (C) +1 last-10 equality
    if (!lead && last10) {
      const plus1 = `+1${last10}`;
      lead =
        (await Lead.findOne({ userEmail: user.email, Phone: plus1 })) ||
        (await Lead.findOne({ userEmail: user.email, phone: plus1 })) ||
        (await Lead.findOne({ userEmail: user.email, ["Phone Number"]: plus1 } as any)) ||
        (await Lead.findOne({ userEmail: user.email, PhoneNumber: plus1 } as any)) ||
        (await Lead.findOne({ userEmail: user.email, Mobile: plus1 } as any)) ||
        (await Lead.findOne({ userEmail: user.email, mobile: plus1 } as any)) ||
        (await Lead.findOne({ userEmail: user.email, "phones.value": plus1 } as any));
    }

    // (D) Anchored last-10 regex
    if (!lead && anchored) {
      lead =
        (await Lead.findOne({ userEmail: user.email, Phone: anchored })) ||
        (await Lead.findOne({ userEmail: user.email, phone: anchored })) ||
        (await Lead.findOne({ userEmail: user.email, ["Phone Number"]: anchored } as any)) ||
        (await Lead.findOne({ userEmail: user.email, PhoneNumber: anchored } as any)) ||
        (await Lead.findOne({ userEmail: user.email, Mobile: anchored } as any)) ||
        (await Lead.findOne({ userEmail: user.email, mobile: anchored } as any)) ||
        (await Lead.findOne({ userEmail: user.email, "phones.value": anchored } as any));
    }
    // ===========================================================

    // Final sanity
    if (lead && last10 && !leadPhoneMatches(lead, fromDigits)) {
      console.warn(
        `[inbound-sms] Rejecting suspect lead match leadId=${String(lead._id)} — phone on lead does not end with ${last10}`,
      );
      lead = null;
    }

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
        console.log("➕ Created minimal lead for inbound:", fromNumber);
      } catch (e) {
        console.warn("⚠️ Failed to auto-create lead:", e);
      }
    }

    if (!lead) {
      return res.status(200).json({ message: "Lead not found/created, acknowledged." });
    }

    console.log(`[inbound-sms] RESOLVED leadId=${lead?._id || null} from=${fromNumber} to=${toNumber}`);

    const hadDrips =
      Array.isArray((lead as any).assignedDrips) && (lead as any).assignedDrips.length > 0;

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
    const inboundEntry = {
      type: "inbound" as const,
      text: body || (numMedia ? "[media]" : ""),
      date: new Date(),
    };
    lead.interactionHistory = lead.interactionHistory || [];
    lead.interactionHistory.push(inboundEntry);
    lead.lastInboundAt = new Date();
    lead.lastInboundBody = body;
    lead.updatedAt = new Date();
    await lead.save();

    if (io) io.to(user.email).emit("message:new", { leadId: lead._id, ...inboundEntry });

    // ✅ Auto-pause any active DripEnrollment for this lead
    try {
      const pauseRes: any = await DripEnrollment.updateMany(
        { userEmail: user.email, leadId: lead._id, status: "active" },
        { $set: { status: "paused", paused: true, isPaused: true, processing: false }, $unset: { nextSendAt: 1, processingAt: 1 } }
      );
      const paused = typeof pauseRes.modifiedCount === "number" ? pauseRes.modifiedCount : (pauseRes.nModified ?? 0);
      if (paused > 0) {
        const note = {
          type: "status" as const,
          text: `[system] Auto-paused ${paused} active drip enrollment(s) due to lead reply.`,
          date: new Date(),
        };
        lead.interactionHistory.push(note);
        await lead.save();
        if (io) io.to(user.email).emit("message:new", { leadId: lead._id, ...note });
        console.log(`⏸️ Auto-paused ${paused} active enrollment(s) for lead ${String(lead._id)}`);
      }
    } catch (e) {
      console.warn("⚠️ Failed to auto-pause drips:", e);
    }

    /* =======================
       Agent email notify
       ======================= */
    try {
      const emailEnabled = user?.notifications?.emailOnInboundSMS !== false;
      if (emailEnabled) {
        const leadDisplayName = resolveLeadDisplayName(
          lead,
          lead.Phone || (lead as any).phone || fromNumber,
        );

        const snippet = body.length > 60 ? `${body.slice(0, 60)}…` : body;
        const dripTag = hadDrips ? "[drip] " : "";
        const deepLink = `${ABS_BASE_URL}${LEAD_ENTRY_PATH}/${lead._id}`;
        const subjectWho =
          leadDisplayName || (lead.Phone || (lead as any).phone || fromNumber);

        await sendLeadReplyNotificationEmail({
          to: user.email,
          replyTo: user.email,
          subject: `[New Lead Reply] ${dripTag}${subjectWho} — ${snippet || "(no text)"}`,
          leadName: leadDisplayName || undefined,
          leadPhone: lead.Phone || (lead as any).phone || fromNumber,
          leadEmail: lead.Email || (lead as any).email || "",
          folder:
            (lead as any).folder ||
            (lead as any).Folder ||
            (lead as any)["Folder Name"],
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

      const note = { type: "status" as const, text: "[system] Lead opted out — moved to Not Interested.", date: new Date() };
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
      const note = { type: "status" as const, text: "[system] HELP detected.", date: new Date() };
      lead.interactionHistory.push(note);
      await lead.save();
      if (io) io.to(user.email).emit("message:new", { leadId: lead._id, ...note });
      return res.status(200).json({ message: "Help handled (no auto-reply)." });
    }

    if (isStart(body)) {
      (lead as any).unsubscribed = false;
      (lead as any).optOut = false;
      const note = { type: "status" as const, text: "[system] START/UNSTOP detected — lead opted back in.", date: new Date() };
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
      const note = { type: "status" as const, text: "[note] Auto-reply suppressed: A2P not approved yet.", date: new Date() };
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
    const isClientRetention = (assignedDrips as any[]).some(
      (id: any) => typeof id === "string" && id.includes("client_retention"),
    );
    if (isClientRetention)
      return res.status(200).json({ message: "Client retention reply — no AI engagement." });

    // ✅ Cancel drips & engage AI (legacy array-based)
    lead.assignedDrips = [];
    (lead as any).dripProgress = [];
    lead.isAIEngaged = true;

    const tz = pickLeadZone(lead);
    const nowISO = DateTime.utc().toISO();
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
    const stateCanon = normalizeStateInput(lead.State || (lead as any).state || "");
    const context = computeContext(lead.assignedDrips);

    // 0) Deterministic intent replies (fast path)
    let aiReply: string | null = buildDeterministicReply(body, context);

    // 1) deterministic time parse from user text
    let requestedISO: string | null = extractRequestedISO(body, stateCanon);

    // 2) Confirmation language binds to last AI proposal
    if (!requestedISO && containsConfirmation(body)) {
      requestedISO =
        extractTimeFromLastAI(lead.interactionHistory || [], stateCanon) ||
        (lead as any).aiLastProposedISO ||
        null;
    }

    // 2.5) explicit info-request (enforce your exact sentence)
    if (!requestedISO && isInfoRequest(body)) {
      aiReply = `Unfortunately as of now there's nothing to send over without getting some information from you. When's a good time for a quick 5 minute call? After that we can send everything out.`;
      aiReply = sanitizeSMS(aiReply);
      memory.state = "qa";
    }

    // 3) conversational fallback via LLM
    if (!requestedISO && !aiReply) {
      try {
        const ex = await extractIntentAndTimeLLM({ text: body, nowISO, tz });
        const norm = normalizeWhen(ex.datetime_text, nowISO, tz);
        if (norm?.start) requestedISO = norm.start.toISO();

        if (!requestedISO) {
          if (ex.intent === "ask_duration") {
            aiReply = sanitizeSMS(`It’s quick—about 10–15 minutes. Would later today or tomorrow afternoon work?`);
            memory.state = "qa";
          } else if (ex.intent === "ask_cost") {
            aiReply = sanitizeSMS(`No cost at all—just a quick review. What’s better for you, today or tomorrow?`);
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
            if (!askedRecently(memory, "chat_followup")) pushAsked(memory, "chat_followup");
            memory.state = "awaiting_time";
          }
        }
      } catch {
        memory.state = "awaiting_time";
        const lastAI = [...(lead.interactionHistory || [])].reverse().find((m: any) => m.type === "ai");
        const v = sanitizeSMS(`What time works for you—today or tomorrow? You can reply like “tomorrow 3:00 pm”.`);
        aiReply = lastAI?.text?.trim() === v
          ? sanitizeSMS(`Shoot me a time that works (e.g., “tomorrow 3:00 pm”) and I’ll text a confirmation.`)
          : v;
      }
    }

    // 4) If we have a concrete time now, confirm + (try to) book
    if (requestedISO) {
      const zone = tz;
      const clientTime = DateTime.fromISO(requestedISO, { zone }).set({ second: 0, millisecond: 0 });

      const alreadyConfirmedSame =
        (lead as any).aiLastConfirmedISO &&
        DateTime.fromISO((lead as any).aiLastConfirmedISO).toISO() === clientTime.toISO();

      if (alreadyConfirmedSame) {
        aiReply = sanitizeSMS(`All set — you’re on my schedule. Talk soon!`);
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

          console.log("📌 Booking payload ->", bookingPayload);

          const bookingRes = await axios.post(
            `${RAW_BASE_URL || ABS_BASE_URL}/api/google/calendar/book-appointment`,
            { ...bookingPayload },
            {
              headers: {
                Authorization: `Bearer ${INTERNAL_API_TOKEN}`,
                "Content-Type": "application/json",
              },
              timeout: 15000,
            },
          );

          if ((bookingRes.data || {}).success) {
            (lead as any).status = "Booked";
            (lead as any).appointmentTime = clientTime.toJSDate();

            try {
              const fullName = resolveLeadDisplayName(
                lead,
                lead.Phone || (lead as any).phone || fromNumber,
              );

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
        aiReply = sanitizeSMS(`Perfect — I’ve got you down for ${readable} ${clientTime.offsetNameShort}. You’ll get a confirmation shortly. Reply RESCHEDULE if you need to change it.`);
        (lead as any).aiLastConfirmedISO = clientTime.toISO();
        (lead as any).aiLastProposedISO = clientTime.toISO();
        memory.state = "scheduled";
        memory.apptISO = clientTime.toISO();
        memory.apptText = requestedISO;
        memory.lastConfirmAtISO = DateTime.utc().toISO();
      }
    }

    // Fallback copy if still empty
    if (!aiReply) {
      aiReply = sanitizeSMS("When’s a good time today or tomorrow for a quick 5-minute chat?");
    }

    memory.lastDraft = aiReply;
    (lead as any).aiMemory = memory;
    // ❗ Do NOT stamp aiLastResponseAt here — it would trigger cooldown skip before we actually send
    await lead.save();

    // Delayed AI reply (human-like), force FROM the exact inbound number
    setTimeout(async () => {
      try {
        await mongooseConnect();

        const fresh = await Lead.findById(lead._id);
        if (!fresh) return;

        // Env-driven cooldown guard (skip if too soon since last AI send)
        if (AI_COOLDOWN_SECONDS > 0 && fresh.aiLastResponseAt) {
          const sinceMs = Date.now() - new Date(fresh.aiLastResponseAt).getTime();
          if (sinceMs < AI_COOLDOWN_SECONDS * 1000) {
            console.log(`⏳ Skipping AI reply (cool-down ${AI_COOLDOWN_SECONDS}s).`);
            return;
          }
        }

        if ((fresh as any).appointmentTime && !(fresh as any).aiLastConfirmedISO) {
          console.log("✅ Appointment already set; skipping nudge.");
          return;
        }

        const lastAI = [...(fresh.interactionHistory || [])].reverse().find((m: any) => m.type === "ai");
        const draft = sanitizeSMS(
          ((fresh as any).aiMemory?.lastDraft as string) ||
          "When’s a good time today or tomorrow for a quick chat?"
        );
        if (lastAI && sanitizeSMS(lastAI.text || "") === draft) {
          console.log("🔁 Same AI content as last time — not sending.");
          // still stamp the time lightly to prevent rapid loops
          fresh.aiLastResponseAt = new Date();
          await fresh.save();
          return;
        }

        const zone = pickLeadZone(fresh);
        const { isQuiet, scheduledAt } = computeQuietHoursScheduling(zone);

        const baseParams = await getSendParams(String(user._id), toNumber, fromNumber, { forceFrom: toNumber });
        const paramsOut: Parameters<Twilio["messages"]["create"]>[0] = {
          ...baseParams,
          body: draft,
          statusCallback: STATUS_CALLBACK,
        };

        const canSchedule = "messagingServiceSid" in paramsOut;
        if (isQuiet && scheduledAt && canSchedule) {
          (paramsOut as any).scheduleType = "fixed";
          (paramsOut as any).sendAt = scheduledAt.toISOString();
        } else if (isQuiet && !canSchedule) {
          console.warn("⚠️ Quiet hours but cannot schedule when forcing a single From number. Sending immediately.");
        }

        // Persist AI message to lead history before network call, so UI reflects immediately
        const aiEntry = { type: "ai" as const, text: draft, date: new Date() };
        fresh.interactionHistory = fresh.interactionHistory || [];
        fresh.interactionHistory.push(aiEntry);
        fresh.aiLastResponseAt = new Date(); // stamp on actual attempt
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

        // ✅ BILLING for AI outbound SMS (platform-billed users)
        try {
          const billUser = await User.findOne({ email: (user.email || "").toLowerCase() });
          if (billUser && billUser.billingMode !== "self") {
            const amount = estimateSmsChargeUSD({
              body: draft || "",
              mediaUrls: (paramsOut as any).mediaUrl || null,
            });
            await trackUsage({ user: billUser, amount, source: "twilio" });
          }
        } catch (e) {
          console.warn("⚠️ Billing (AI outbound SMS) failed (non-fatal):", (e as any)?.message || e);
        }

        let io2 = (res as any)?.socket?.server?.io;
        if (io2) io2.to(user.email).emit("message:new", { leadId: fresh._id, ...aiEntry });

        if (isQuiet && scheduledAt && canSchedule) {
          console.log(
            `🕘 Quiet hours: scheduled AI reply to ${fromNumber} at ${scheduledAt.toISOString()} (${zone}) | SID: ${(twilioMsg as any)?.sid}`,
          );
        } else {
          console.log(
            `🤖 AI reply sent to ${fromNumber} FROM ${toNumber} | SID: ${(twilioMsg as any)?.sid}`,
          );
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
  opts?: { forceFrom?: string },
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
