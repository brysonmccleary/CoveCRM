// /pages/api/twilio/inbound-sms.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import Message from "@/models/Message";
import DripEnrollment from "@/models/DripEnrollment";
import DripCampaign from "@/models/DripCampaign";
import { AiQueuedReply } from "@/models/AiQueuedReply";
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
import { sendSms } from "@/lib/twilio/sendSMS";
import { sendIncomingSmsPush } from "@/lib/mobile/push";
import { trackUsage } from "@/lib/billing/trackUsage";
import { priceOpenAIUsage } from "@/lib/billing/openaiPricing";

export const config = { api: { bodyParser: false } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const RAW_BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(
  /\/$/,
  "",
);
const SHARED_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || "";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";
const LEAD_ENTRY_PATH = (process.env.APP_LEAD_ENTRY_PATH || "/lead").replace(/\/?$/, "");
const BUILD_TAG = "inbound-sms@2025-12-06-o3-mini-upgrade";
console.log(`[inbound-sms] build=${BUILD_TAG}`);

const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL ||
  (RAW_BASE_URL ? `${RAW_BASE_URL}/api/twilio/status-callback` : undefined);

const ALLOW_DEV_TWILIO_TEST =
  process.env.ALLOW_LOCAL_TWILIO_TEST === "1" && process.env.NODE_ENV !== "production";

// Human delay: 3–5 minutes in production, 3–5 seconds in AI_TEST_MODE
const AI_TEST_MODE = process.env.AI_TEST_MODE === "1";
function humanDelayMs() {
  return AI_TEST_MODE ? 3000 + Math.random() * 2000 : 180000 + Math.random() * 60000;
}

// ---------- quiet hours (lead-local) ----------
const QUIET_START_HOUR = 21; // 9:00 PM
const QUIET_END_HOUR = 8; // 8:00 AM
const MIN_SCHEDULE_LEAD_MINUTES = 15;

// ---- State normalization + zone resolution ----
const STATE_CODE_FROM_NAME: Record<string, string> = {
  // Eastern
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
  // Central
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
  // Mountain
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
  // Pacific
  california: "CA",
  ca: "CA",
  oregon: "OR",
  or: "OR",
  washington: "WA",
  wa: "WA",
  nevada: "NV",
  nv: "NV",
  // Alaska / Hawaii
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
  // Central
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
  // Mountain
  CO: "America/Denver",
  NM: "America/Denver",
  WY: "America/Denver",
  MT: "America/Denver",
  UT: "America/Denver",
  ID: "America/Denver",
  AZ: "America/Phoenix",
  // Pacific
  CA: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  NV: "America/Los_Angeles",
  // Alaska / Hawaii
  AK: "America/Anchorage",
  HI: "Pacific/Honolulu",
};

function normalizeStateInput(raw: string | undefined | null): string {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return STATE_CODE_FROM_NAME[s]
    ? STATE_CODE_FROM_NAME[s]
    : STATE_CODE_FROM_NAME[s.slice(0, 2)]
    ? STATE_CODE_FROM_NAME[s.slice(0, 2)]
    : "";
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
    target = nowLocal.set({
      hour: QUIET_END_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
  } else {
    target = nowLocal.plus({ days: 1 }).set({
      hour: QUIET_END_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
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

/**
 * FAQ overrides for specific questions:
 * - "who are you with?"
 * - "what is mortgage protection?"
 *
 * Returns a hard-coded Jeremy-style reply (with booking question).
 */
function getFaqOverrideReply(text: string): string | null {
  const t = (text || "").trim().toLowerCase();
  if (!t) return null;

  // "Who are you with?" / "Who do you work for?" etc.
  const whoTriggers = [
    "who are you with",
    "who you with",
    "who do you work for",
    "who are you calling with",
    "who is this with",
    "what company are you with",
    "what company do you work for",
    "who are you from",
  ];
  if (whoTriggers.some((p) => t.includes(p))) {
    return "I’m a broker through the state contracted with all the companies that offer these products. My job is to find you the best rate for the coverage. When do you have five minutes for a quick call?";
  }

  // "What is mortgage protection?"
  const mpTriggers = [
    "what is mortgage protection",
    "what’s mortgage protection",
    "whats mortgage protection",
    "what is mortgage protection insurance",
  ];
  if (
    mpTriggers.some((p) => t.includes(p)) ||
    (t.includes("mortgage protection") && t.includes("?"))
  ) {
    return "Mortgage protection is a privately owned insurance policy that pays off and/or pays down the house in the event of a death or disability so your family can keep the house if something happens. When do you have five minutes for a quick call?";
  }

  return null;
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
      const dt = now.plus({ days: 1 }).set({ hour: h, minute: min, second: 0, millisecond: 0 });
      return dt.isValid ? dt.toISO() : null;
    }
  }

  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
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

// NEW: inherit "tomorrow" + AM/PM from the last AI message when the lead says only a time like "let's do 11"
function inferTimeFromLastAITomorrow(
  inboundText: string,
  state?: string,
  history?: any[],
): string | null {
  const lastAI = [...(history || [])].reverse().find((m: any) => m.type === "ai");
  if (!lastAI?.text) return null;

  const lastText = String(lastAI.text).toLowerCase();
  if (!lastText.includes("tomorrow")) return null;

  const lowerInbound = (inboundText || "").toLowerCase();
  const timeRe = /(\b\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/;
  const mInbound = lowerInbound.match(timeRe);
  if (!mInbound) return null;

  let hour = parseInt(mInbound[1], 10);
  const minute = mInbound[2] ? parseInt(mInbound[2], 10) : 0;
  let ap: string | undefined = mInbound[3] as string | undefined;

  if (!ap) {
    const matchesInLast = [...lastText.matchAll(timeRe)];
    for (const match of matchesInLast) {
      const h = parseInt(match[1], 10);
      const apCandidate = match[3] as string | undefined;
      if (h === hour && apCandidate) {
        ap = apCandidate;
        break;
      }
    }
  }

  const zone = zoneFromAnyState(state || "") || "America/New_York";
  let base = DateTime.now().setZone(zone).plus({ days: 1 }); // "tomorrow" in client zone

  if (ap) {
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
  }

  let dt = base.set({ hour, minute, second: 0, millisecond: 0 });
  if (!dt.isValid) return null;
  return dt.toISO();
}

// ✅ UPDATED: context from drips + campaign names
function computeContext(drips?: string[], campaignNames?: string[]) {
  const lower = (s: string) => s.toLowerCase();
  const tokens: string[] = [];

  if (Array.isArray(drips)) {
    for (const d of drips) tokens.push(lower(String(d)));
  }
  if (Array.isArray(campaignNames)) {
    for (const n of campaignNames) tokens.push(lower(String(n)));
  }

  const joined = tokens.join(" | ");

  if (joined.includes("mortgage")) return "mortgage protection";
  if (joined.includes("veteran")) return "life insurance for veterans";
  if (
    joined.includes("final expense") ||
    joined.includes("final_expense") ||
    joined.includes("fex")
  )
    return "final expense life insurance";
  if (joined.includes("iul")) return "indexed universal life and retirement income protection";
  if (joined.includes("retention")) return "existing client retention and policy reviews";
  if (joined.includes("birthday") || joined.includes("holiday"))
    return "client birthdays, holidays, and policy reviews";

  // Safe generic fallback
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

// ===== NEW: billing context for OpenAI =====
let _lastInboundUserEmailForBilling: string | null = null;

// --- LLM helpers (INTENT extractor still using gpt-4o-mini; left as-is)
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

  try {
    const usage = (resp as any)?.usage || {};
    const raw = priceOpenAIUsage({
      model: "gpt-4o-mini",
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
    });
    if (raw > 0 && _lastInboundUserEmailForBilling) {
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
    const text = String(m.text);
    // Skip system notes
    if (text.startsWith("[system]") || text.startsWith("[note]")) continue;
    if (m.type === "inbound") msgs.push({ role: "user", content: text });
    else if (m.type === "ai" || m.type === "outbound") msgs.push({ role: "assistant", content: text });
  }
  return msgs.slice(-24);
}

// --- Deterministic reply shortcuts (currently UNUSED – we rely on GPT for convo)
function buildDeterministicReply(_textRaw: string, _context: string): string | null {
  return null;
}

/* -------------------------------------------------------------------------------------
   RESPONSES API (o3-mini) WRAPPER + TOOLS
   - This is the ONLY place we call the model for SMS replies.
   - All Twilio, quiet hours, drips, booking queueing, etc. remain unchanged.
-------------------------------------------------------------------------------------- */

type SmsToolEnv = {
  lead: any;
  user: any;
  tz: string;
};

type SmsToolCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

// --- Tool implementations (these DO NOT change any existing flows; they are additive) ---
async function runBookAppointmentTool(
  args: { leadId: string; datetime: string; timezone?: string },
  env: SmsToolEnv,
): Promise<any> {
  const { lead, user, tz } = env;
  const zone = args.timezone || tz || pickLeadZone(lead);
  const dt = DateTime.fromISO(args.datetime, { zone });
  const now = DateTime.now().setZone(zone);

  if (!dt.isValid || dt <= now) {
    return {
      ok: false,
      reason: "invalid_or_past_time",
    };
  }

  // Store on lead (this mirrors your existing appointment fields; we do NOT touch quiet hours or queueing)
  (lead as any).status = "Booked";
  (lead as any).appointmentTime = dt.toJSDate();
  (lead as any).aiLastConfirmedISO = dt.toISO();
  (lead as any).aiLastProposedISO = dt.toISO();
  lead.interactionHistory = lead.interactionHistory || [];
  lead.interactionHistory.push({
    type: "ai",
    text: `[system] Appointment booked via AI tool for ${dt.toFormat(
      "ccc, MMM d 'at' h:mm a",
    )} (${zone}).`,
    date: new Date(),
  });
  await lead.save();

  return {
    ok: true,
    timeISO: dt.toISO(),
    timezone: zone,
    readable: dt.toFormat("ccc, MMM d 'at' h:mm a"),
    leadId: String(lead._id),
    agentEmail: (lead.userEmail || user.email || "").toLowerCase(),
  };
}

async function runUpdateLeadStatusTool(
  args: { leadId: string; status: string },
  env: SmsToolEnv,
): Promise<any> {
  const { lead } = env;
  const status = String(args.status || "").trim() || "New";

  (lead as any).status = status;
  (lead as any).updatedAt = new Date();
  lead.interactionHistory = lead.interactionHistory || [];
  lead.interactionHistory.push({
    type: "ai",
    text: `[system] Status updated via AI tool to "${status}".`,
    date: new Date(),
  });
  await lead.save();

  return {
    ok: true,
    status,
    leadId: String(lead._id),
  };
}

async function runAddNoteTool(
  args: { leadId: string; text: string },
  env: SmsToolEnv,
): Promise<any> {
  const { lead } = env;
  const noteText = String(args.text || "").trim();
  if (!noteText) {
    return { ok: false, reason: "empty_text" };
  }

  lead.interactionHistory = lead.interactionHistory || [];
  lead.interactionHistory.push({
    type: "ai",
    text: `[note] ${noteText}`,
    date: new Date(),
  });
  await lead.save();

  return {
    ok: true,
    leadId: String(lead._id),
  };
}

// --- Core wrapper that actually calls o3-mini Responses API + tools ---
async function runO3MiniSmsAssistant(opts: {
  lead: any;
  user: any;
  userEmail: string;
  context: string;
  tz: string;
  inboundText: string;
  history: any[];
}): Promise<string> {
  const { lead, user, context, tz, inboundText, history } = opts;

  const recentAssistant = (history || [])
    .filter((m: any) => m?.type === "ai")
    .map((m: any) => (m.text || "").trim())
    .filter(Boolean)
    .slice(-5);

  // --- SYSTEM PROMPT (Jeremy-style, appointment only, no quotes/details) ---
  const systemPrompt = `
You are an SMS appointment-setting assistant for a licensed insurance agent.
You are NOT a licensed agent yourself. You NEVER give quotes, product details, carrier advice, or policy recommendations.

PRODUCT CONTEXT:
- Primary focus: ${context || "life insurance and mortgage protection"}.
- Your ONLY job is to book a quick phone appointment so the agent can explain everything.

STYLE (Jeremy Lee Minor–inspired):
- Short, friendly, confident, and direct.
- 1–2 sentences per reply, ~240 characters max.
- Sound like a real human texting, not a bot.
- No emojis, no links, no signatures, no disclaimers.
- Never repeat the same sentence or opening line twice in a row.
- Local timezone for the lead: ${tz}.

BEHAVIOR:
- Always acknowledge what they just said in your own words, then pivot back to booking a quick 5–10 minute call.
- Ask exactly ONE clear question that moves the conversation toward a specific time.
- If they ask for info by text/email/mail, say:
  "Unfortunately as of now there's nothing to send over without getting some information from you, when's a good time for a quick 5 minute call and then we can send everything out"
- Do NOT talk about prices, rates, specific companies, or plan details. If asked, say the agent will cover that on the call and then ask for a time.
- If a time is already agreed on and CONFIRMED, keep it short: acknowledge and remind them you're looking forward to the call.

TOOLS:
- You can optionally:
  • bookAppointment(leadId, datetime, timezone) to save a booked time.
  • updateLeadStatus(leadId, status) when they are clearly Not Interested, Booked, Reschedule Requested, etc.
  • addNote(leadId, text) for useful internal notes.
- Only call tools when it clearly helps the agent (e.g., a firm time given, clear status change, or important note).
- Even when you call tools, you must still send a natural SMS reply to the lead.

RECENT ASSISTANT PHRASES TO AVOID REPEATING:
${recentAssistant.length ? recentAssistant.join(" | ") : "(none yet)"}
`.trim();

  // --- Messages history (converted to Responses API format) ---
  const chatHistory = historyToChatMessages(history);
  const inputMessages: any[] = [
    { type: "message", role: "system", content: systemPrompt },
    ...chatHistory.map((m) => ({
      type: "message",
      role: m.role,
      content: m.content,
    })),
    { type: "message", role: "user", content: inboundText },
  ];

  // --- Tool definitions (JSON-schema style) ---
  const tools: any[] = [
    {
      type: "function",
      name: "bookAppointment",
      description:
        "Save a firm appointment time for this lead once they clearly agree to a specific datetime.",
      parameters: {
        type: "object",
        properties: {
          leadId: {
            type: "string",
            description: "The MongoDB _id of the lead being booked.",
          },
          datetime: {
            type: "string",
            description:
              "ISO-8601 datetime string for the appointment in the lead's local timezone.",
          },
          timezone: {
            type: "string",
            description:
              "IANA timezone name like America/New_York or America/Chicago. Use this if needed.",
          },
        },
        required: ["leadId", "datetime"],
      },
    },
    {
      type: "function",
      name: "updateLeadStatus",
      description:
        "Update the lead's status when they are clearly booked, not interested, want to reschedule, etc.",
      parameters: {
        type: "object",
        properties: {
          leadId: {
            type: "string",
            description: "The MongoDB _id of the lead.",
          },
          status: {
            type: "string",
            description:
              "A short status label such as 'Booked', 'Not Interested', 'Reschedule Requested', or 'Follow Up'.",
          },
        },
        required: ["leadId", "status"],
      },
    },
    {
      type: "function",
      name: "addNote",
      description:
        "Add an internal note about this lead for the agent (do NOT show note text to the lead).",
      parameters: {
        type: "object",
        properties: {
          leadId: {
            type: "string",
            description: "The MongoDB _id of the lead.",
          },
          text: {
            type: "string",
            description: "Short internal note (reason for reschedule, key objection, etc.).",
          },
        },
        required: ["leadId", "text"],
      },
    },
  ];

  // --- First Responses API call ---
  const response = await openai.responses.create({
    model: "o3-mini",
    input: inputMessages,
    tools,
    reasoning: { effort: "medium" },
  });

  let totalPromptTokens = (response as any)?.usage?.input_tokens || 0;
  let totalCompletionTokens = (response as any)?.usage?.output_tokens || 0;

  const env: SmsToolEnv = { lead, user, tz };
  const toolOutputs: SmsToolCallOutput[] = [];

  for (const out of (response as any).output || []) {
    if (out.type === "function_call") {
      const name = out.name as string;
      const callId = out.call_id as string;
      let parsedArgs: any = {};
      try {
        parsedArgs = out.arguments ? JSON.parse(out.arguments as string) : {};
      } catch {
        parsedArgs = {};
      }

      let toolResult: any = null;
      try {
        if (name === "bookAppointment") {
          toolResult = await runBookAppointmentTool(parsedArgs, env);
        } else if (name === "updateLeadStatus") {
          toolResult = await runUpdateLeadStatusTool(parsedArgs, env);
        } else if (name === "addNote") {
          toolResult = await runAddNoteTool(parsedArgs, env);
        } else {
          toolResult = { ok: false, reason: `unknown_tool:${name}` };
        }
      } catch (err: any) {
        toolResult = {
          ok: false,
          reason: "exception",
          message: err?.message || String(err || ""),
        };
      }

      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(toolResult || {}),
      });
    }
  }

  let finalResponse = response;

  // If tools were called, send tool outputs back into Responses API for a final natural-language reply
  if (toolOutputs.length > 0) {
    const followup = await openai.responses.create({
      model: "o3-mini",
      previous_response_id: (response as any).id,
      input: toolOutputs,
    });
    finalResponse = followup;
    totalPromptTokens += (followup as any)?.usage?.input_tokens || 0;
    totalCompletionTokens += (followup as any)?.usage?.output_tokens || 0;
  }

  // --- Billing for o3-mini usage ---
  try {
    const cost = priceOpenAIUsage({
      model: "o3-mini",
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
    });
    if (cost > 0 && _lastInboundUserEmailForBilling) {
      await trackUsage({
        user: { email: _lastInboundUserEmailForBilling },
        amount: cost,
        source: "openai",
      });
    }
  } catch (e) {
    console.warn("[inbound-sms] Failed to track o3-mini usage:", e);
  }

  // --- Extract final text reply from Responses API output ---
  const outArray = (finalResponse as any).output || [];
  let candidate = "";

  // Prefer output_text if present
  if ((finalResponse as any).output_text) {
    candidate = String((finalResponse as any).output_text || "").trim();
  } else {
    // Otherwise grab first assistant message's text content
    for (const out of outArray) {
      if (out.type === "message" && out.role === "assistant") {
        const contents = out.content || [];
        const textPart = contents.find((c: any) => c.type === "output_text" || c.type === "text");
        if (textPart?.text) {
          candidate = String(textPart.text).trim();
          break;
        }
      }
    }
  }

  if (!candidate) {
    candidate =
      "Got it — what time works for a quick 5 minute call today or tomorrow so the agent can walk you through everything?";
  }

  // Normalize whitespace
  return candidate.replace(/\s+/g, " ").trim();
}

// --- conversational reply (now uses o3-mini Responses API wrapper) ---
async function generateConversationalReply(opts: {
  lead: any;
  user: any;
  userEmail: string;
  context: string;
  tz: string;
  inboundText: string;
  history: any[];
}) {
  const { lead, user, userEmail, context, tz, inboundText, history } = opts;

  // If you ever want deterministic shortcuts, plug them in here (still unused)
  const deterministic = buildDeterministicReply(inboundText, context);
  if (deterministic) return deterministic;

  try {
    const reply = await runO3MiniSmsAssistant({
      lead,
      user,
      userEmail,
      context,
      tz,
      inboundText,
      history,
    });
    return reply;
  } catch (err) {
    console.error("[inbound-sms] o3-mini Responses API failed, falling back:", err);
    const lastAI = [...(history || [])].reverse().find((m: any) => m.type === "ai");
    const fallback =
      "When’s a good time today or tomorrow for a quick 5 minute call so we can go over everything with you?";
    if (lastAI?.text?.trim() === fallback) {
      return `Got it — send me a time that works (for example “tomorrow 3:00 pm”) and I’ll text a confirmation.`;
    }
    return fallback;
  }
}

function normalizeWhen(datetimeText: string | null, _nowISO: string, tz: string) {
  if (!datetimeText) return null;
  const iso = extractRequestedISO(datetimeText);
  if (iso) return { start: DateTime.fromISO(iso).setZone(tz) };
  return null;
}

/* --------- Only trust a previous outbound if that lead’s phone actually matches this inbound --------- */
function leadPhoneMatches(lead: any, fromDigits: string): boolean {
  if (!lead) return false;
  const cand: string[] = [];
  const push = (v: any) => {
    if (v) cand.push(normalizeDigits(String(v)));
  };
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

function isPlaceholderLead(l: any): boolean {
  const fn = String((l as any)["First Name"] || (l as any).firstName || "")
    .trim()
    .toLowerCase();
  const ln = String((l as any)["Last Name"] || (l as any).lastName || "")
    .trim()
    .toLowerCase();
  const full = `${fn} ${ln}`.trim();
  return (
    (l as any).source === "inbound_sms" &&
    (full === "sms lead" || (fn === "sms" && ln === "lead"))
  );
}

// ----------------------------------------------------------------------------------------------------------

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
  const absoluteUrl = host
    ? `${proto}://${host}${pathOnly}`
    : RAW_BASE_URL
    ? `${RAW_BASE_URL}${pathOnly}`
    : "";

  // Verify Twilio signature (unless dev bypass)
  const signature = (req.headers["x-twilio-signature"] || "") as string;

  // ✅ Prod-safe test bypass via Authorization: Bearer INTERNAL_API_TOKEN
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
      `📥 inbound sid=${messageSid || "n/a"} from=${fromNumber} -> to=${toNumber} text="${body.slice(
        0,
        120,
      )}${body.length > 120 ? "…" : ""}"`,
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

    // ✅ NEW: set billing context for OpenAI
    _lastInboundUserEmailForBilling = (user.email || "").toLowerCase();

    // ===================== LEAD RESOLUTION (strict) =====================
    const fromDigits = normalizeDigits(fromNumber);
    const last10 = fromDigits.slice(-10);

    let lead: any = null;

    if (last10) {
      const candidates = await Lead.find({
        userEmail: user.email,
        $or: [
          { Phone: { $exists: true, $ne: null } },
          { phone: { $exists: true, $ne: null } },
          { ["Phone Number"]: { $exists: true, $ne: null } } as any,
          { PhoneNumber: { $exists: true, $ne: null } } as any,
          { Mobile: { $exists: true, $ne: null } } as any,
          { mobile: { $exists: true, $ne: null } } as any,
          { "phones.value": { $exists: true, $ne: null } } as any,
        ],
      }).exec();

      const matching = candidates.filter((l) => leadPhoneMatches(l, fromDigits));

      if (matching.length === 1) {
        lead = matching[0];
      } else if (matching.length > 1) {
        const scoreLead = (l: any) => {
          let score = 0;
          if (!isPlaceholderLead(l)) score += 5;
          else score -= 5;
          if ((l as any).source && (l as any).source !== "inbound_sms") score += 2;
          if ((l as any).status && (l as any).status !== "New") score += 1;
          if (Array.isArray((l as any).assignedDrips) && (l as any).assignedDrips.length > 0)
            score += 1;
          if ((l as any).updatedAt) score += 0.000001 * new Date((l as any).updatedAt).getTime();
          return score;
        };

        let best = matching[0];
        let bestScore = scoreLead(best);
        for (const c of matching.slice(1)) {
          const s = scoreLead(c);
          if (s > bestScore) {
            best = c;
            bestScore = s;
          }
        }

        console.log(
          `[inbound-sms] Multiple leads share phone ending ${last10}; chose ${String(
            best._id,
          )} from ${matching.length} candidates.`,
        );
        lead = best;
      }
    }

    if (!lead) {
      try {
        lead = await Lead.create({
          userEmail: user.email,
          Phone: fromNumber,
          phone: fromNumber,
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
    // ======================================================================

    // Pause any active DripEnrollments for this lead (drip → AI handoff),
    // AND capture campaign names for AI context (mortgage vs vets vs IUL, etc.)
    let pausedCount = 0;
    let campaignNames: string[] = [];
    let activeEnrollments: any[] = [];

    try {
      activeEnrollments = await DripEnrollment.find({
        leadId: lead._id,
        userEmail: user.email,
        status: "active",
      })
        .select({ _id: 1, campaignId: 1 })
        .lean();

      const campaignIds = activeEnrollments.map((e: any) => e.campaignId).filter(Boolean);

      if (campaignIds.length) {
        const campaigns = await DripCampaign.find({ _id: { $in: campaignIds } })
          .select({ _id: 1, name: 1 })
          .lean();
        campaignNames = campaigns
          .map((c: any) => String(c.name || "").trim())
          .filter(Boolean);
      }

      const result = await DripEnrollment.updateMany(
        { leadId: lead._id, userEmail: user.email, status: "active" },
        {
          $set: {
            status: "paused",
            paused: true,
            isPaused: true,
            isActive: false,
            stopAll: true,
            nextSendAt: null,
          },
          $unset: {
            processing: 1,
            processingAt: 1,
          },
        },
      );

      pausedCount = (result as any).modifiedCount ?? (result as any).nModified ?? 0;

      if (pausedCount > 0) {
        console.log(`⏸️ Paused ${pausedCount} DripEnrollment(s) for lead ${lead._id}`);
      }
    } catch (e) {
      console.warn("⚠️ Failed to pause DripEnrollments on reply:", e);
    }

    const hadAssignedDrips =
      Array.isArray((lead as any).assignedDrips) && (lead as any).assignedDrips.length > 0;
    const hadDrips = hadAssignedDrips || pausedCount > 0 || activeEnrollments.length > 0;

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
    const savedMessage = await Message.create({
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

    // Compute display name once for email + push
    const leadDisplayName = resolveLeadDisplayName(
      lead,
      lead.Phone || (lead as any).phone || fromNumber,
    );

    /* Agent email notify */
    try {
      const emailEnabled = user?.notifications?.emailOnInboundSMS !== false;
      if (emailEnabled) {
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

    // 🔔 Mobile push notifications for inbound SMS (via helper)
    try {
      await sendIncomingSmsPush({
        userEmail: user.email,
        fromPhone: fromNumber,
        previewText: body || (numMedia ? "[media]" : ""),
        // IDs so mobile can deep-link directly
        leadId: lead._id.toString(),
        conversationId: lead._id.toString(),
        messageId: savedMessage._id.toString(),
        leadName: leadDisplayName || undefined,
      });
    } catch (e) {
      console.warn("⚠️ Failed to send mobile push notification:", (e as any)?.message || e);
    }

    // === Keyword handling (flags only)
    if (isOptOut(body)) {
      lead.assignedDrips = [];
      (lead as any).dripProgress = [];
      lead.isAIEngaged = false;
      (lead as any).unsubscribed = true;
      (lead as any).optOut = true;
      (lead as any).status = "Not Interested";
      const note = {
        type: "ai" as const,
        text: "[system] Lead opted out — moved to Not Interested.",
        date: new Date(),
      };
      lead.interactionHistory = lead.interactionHistory || [];
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
      const note = {
        type: "ai" as const,
        text: "[system] HELP detected.",
        date: new Date(),
      };
      lead.interactionHistory = lead.interactionHistory || [];
      lead.interactionHistory.push(note);
      await lead.save();
      if (io) io.to(user.email).emit("message:new", { leadId: lead._id, ...note });
      return res.status(200).json({ message: "Help handled (no auto-reply)." });
    }

    if (isStart(body)) {
      (lead as any).unsubscribed = false;
      (lead as any).optOut = false;
      const note = {
        type: "ai" as const,
        text: "[system] START/UNSTOP detected — lead opted back in.",
        date: new Date(),
      };
      lead.interactionHistory = lead.interactionHistory || [];
      lead.interactionHistory.push(note);
      await lead.save();
      if (io) io.to(user.email).emit("message:new", { leadId: lead._id, ...note });
      console.log("🔓 Opt-in restored for", fromNumber);
      return res.status(200).json({ message: "Start handled." });
    }

    // A2P gate
    const a2p = await A2PProfile.findOne({ userId: String(user._id) });
    const usConversation = isUS(fromNumber) || isUS(toNumber);
    const approved =
      SHARED_MESSAGING_SERVICE_SID ||
      (a2p?.messagingReady && a2p?.messagingServiceSid);
    if (usConversation && !approved) {
      const note = {
        type: "ai" as const,
        text: "[note] Auto-reply suppressed: A2P not approved yet.",
        date: new Date(),
      };
      lead.interactionHistory = lead.interactionHistory || [];
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

    // Keep original assignedDrips snapshot for context before we clear it
    const legacyAssignedDrips = Array.isArray((lead as any).assignedDrips)
      ? [...(lead as any).assignedDrips]
      : [];

    // Do not engage AI for retention campaigns
    const assignedDrips = (lead as any).assignedDrips || [];
    const isClientRetention = (assignedDrips as any[]).some(
      (id: any) => typeof id === "string" && id.includes("client_retention"),
    );
    if (isClientRetention)
      return res.status(200).json({ message: "Client retention reply — no AI engagement." });

    // ✅ Cancel drips & engage AI (legacy arrays)
    lead.assignedDrips = [];
    (lead as any).dripProgress = [];
    lead.isAIEngaged = true;

    const tz = pickLeadZone(lead);
    const nowISO = DateTime.utc().toISO();
    const memory = {
      state: ((lead as any).aiMemory?.state as ConvState) || "idle",
      lastAsked: (lead as any).aiMemory?.lastAsked || [],
      apptISO: (lead as any).aiMemory?.apptISO || null,
      apptText: (lead as any).aiMemory?.apptText || null,
      tz,
      lastConfirmAtISO: (lead as any).aiMemory?.lastConfirmAtISO || null,
      lastDraft: (lead as any).aiMemory?.lastDraft || null,
    } as any;

    const stateCanon = normalizeStateInput(lead.State || (lead as any).state || "");
    const context = computeContext(legacyAssignedDrips, campaignNames);

    // GPT-first logic (now o3-mini)
    let aiReply: string | null = null;
    let requestedISO: string | null = null;

    // 🔒 Hard-coded FAQ overrides for "who are you with" / "what is mortgage protection"
    const faqOverride = getFaqOverrideReply(body);
    if (!faqOverride) {
      // 1) Direct parse of any concrete time in their text
      requestedISO = extractRequestedISO(body, stateCanon);

      // 1b) If they are selecting a time that was offered "tomorrow" in the last AI message (e.g. "let's do 11")
      if (!requestedISO) {
        requestedISO = inferTimeFromLastAITomorrow(
          body,
          stateCanon,
          lead.interactionHistory || [],
        );
      }

      // 2) If they’re confirming ("that works", etc.), reuse last proposed or last AI-suggested time
      if (!requestedISO && containsConfirmation(body)) {
        requestedISO =
          extractTimeFromLastAI(lead.interactionHistory || [], stateCanon) ||
          (lead as any).aiLastProposedISO ||
          null;
      }

      // 3) If we still don’t have a concrete time, let o3-mini drive a natural Jeremy-style reply
      if (!requestedISO) {
        try {
          aiReply = await generateConversationalReply({
            lead,
            user,
            userEmail: user.email,
            context,
            tz,
            inboundText: body,
            history: lead.interactionHistory || [],
          });
          if (!askedRecently(memory, "chat_followup")) pushAsked(memory, "chat_followup");
          memory.state = "awaiting_time";
        } catch (err) {
          console.error("[inbound-sms] GPT conversational reply failed:", err);
          memory.state = "awaiting_time";
          const lastAI = [...(lead.interactionHistory || [])].reverse().find(
            (m: any) => m.type === "ai",
          );
          const v =
            "When’s a good time today or tomorrow for a quick 5-minute chat?";
          aiReply =
            lastAI?.text?.trim() === v
              ? `Got it — send me a time that works (for example “tomorrow 3:00 pm”) and I’ll text a confirmation.`
              : v;
        }
      }
    } else {
      // For FAQ answers, use the exact scripted reply (already includes booking question)
      aiReply = faqOverride;
      memory.state = "awaiting_time";
    }

    // 4) If we DO have a concrete time, book it and send a confirmation
    if (requestedISO) {
      const zone = tz;
      const clientTime = DateTime.fromISO(requestedISO, { zone }).set({
        second: 0,
        millisecond: 0,
      });

      const nowUtc = DateTime.utc();
      const apptUtc = clientTime.toUTC();

      // 🚫 NEW: Never book or confirm a time that is already in the past
      if (!clientTime.isValid || apptUtc <= nowUtc) {
        console.log(
          "[inbound-sms] Skipping booking/confirmation for past or invalid time:",
          clientTime.toISO(),
        );
        aiReply =
          "It looks like that time might have already passed on my end — what works later today or tomorrow for a quick 5 minute call?";
        memory.state = "awaiting_time";
      } else {
        const alreadyConfirmedSame =
          (lead as any).aiLastConfirmedISO &&
          DateTime.fromISO((lead as any).aiLastConfirmedISO).toISO() === clientTime.toISO();

        if (alreadyConfirmedSame) {
          aiReply = "All set — you’re on my schedule. Talk soon!";
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
                  eventUrl: (bookingRes.data?.event?.htmlLink ||
                    bookingRes.data?.htmlLink ||
                    "") as string | undefined,
                });
              } catch (e) {
                console.warn("Email send failed (appointment):", e);
              }
            } else {
              console.warn("⚠️ Booking API responded but not success:", bookingRes.data);
            }
          } catch (e) {
            console.error(
              "⚠️ Booking API failed (proceeding to confirm by SMS):",
              (e as any)?.response?.data || e,
            );
          }

          const readable = clientTime.toFormat("ccc, MMM d 'at' h:mm a");
          aiReply = `Perfect — I’ve got you down for ${readable} ${
            clientTime.offsetNameShort
          }. You’ll get a confirmation shortly. Reply RESCHEDULE if you need to change it.`;
          (lead as any).aiLastConfirmedISO = clientTime.toISO();
          (lead as any).aiLastProposedISO = clientTime.toISO();
          memory.state = "scheduled";
          memory.apptISO = clientTime.toISO();
          memory.apptText = requestedISO;
          memory.lastConfirmAtISO = DateTime.utc().toISO();
        }
      }
    }

    if (!aiReply) {
      aiReply = "When’s a good time today or tomorrow for a quick 5-minute chat?";
    }

    memory.lastDraft = aiReply;
    (lead as any).aiMemory = memory;
    await lead.save();

    // === QUEUE AI REPLY FOR LATER SEND (human delay) ===
    try {
      const cooldownMs = AI_TEST_MODE ? 2000 : 2 * 60 * 1000;
      if (
        lead.aiLastResponseAt &&
        Date.now() - new Date(lead.aiLastResponseAt).getTime() < cooldownMs
      ) {
        console.log("⏳ Skipping AI reply (cool-down).");
        return res.status(200).json({
          message: "Inbound received; AI reply skipped by cooldown.",
        });
      }

      const lastAI = [...(lead.interactionHistory || [])].reverse().find(
        (m: any) => m.type === "ai",
      );
      const draft = aiReply;
      if (lastAI && lastAI.text?.trim() === draft.trim()) {
        console.log("🔁 Same AI content as last time — not queueing.");
        return res.status(200).json({
          message: "Inbound received; AI reply skipped (duplicate content).",
        });
      }

      const delayMs = humanDelayMs();
      const sendAfter = new Date(Date.now() + delayMs);

      const queued = await AiQueuedReply.create({
        leadId: lead._id,
        userEmail: user.email,
        to: fromNumber,
        body: draft,
        sendAfter,
        status: "queued",
        attempts: 0,
      });

      const aiEntry = { type: "ai" as const, text: draft, date: new Date() };
      lead.interactionHistory = lead.interactionHistory || [];
      lead.interactionHistory.push(aiEntry);
      lead.aiLastResponseAt = new Date();
      await lead.save();

      if (io) {
        io.to(user.email).emit("message:new", { leadId: lead._id, ...aiEntry });
        io.to(user.email).emit("ai:queued", {
          leadId: lead._id,
          queuedId: queued._id,
          sendAfter,
        });
      }

      console.log(
        `🤖 AI reply queued for ${fromNumber} | queuedId=${queued._id} sendAfter=${sendAfter.toISOString()}`,
      );

      return res.status(200).json({
        message: "Inbound received; AI reply queued.",
        queuedId: String(queued._id),
        sendAfter,
      });
    } catch (err) {
      console.error("❌ AI SMS queue failed:", err);
      const note = {
        type: "ai" as const,
        text: "[system] AI reply failed to queue. Agent should follow up manually.",
        date: new Date(),
      };
      lead.interactionHistory = lead.interactionHistory || [];
      lead.interactionHistory.push(note);
      await lead.save();
      if (io) io.to(user.email).emit("message:new", { leadId: lead._id, ...note });
      return res.status(200).json({
        message: "Inbound received; AI reply failed to queue.",
      });
    }
  } catch (error: any) {
    console.error("❌ SMS handler failed:", error);
    return res.status(200).json({
      message: "Inbound SMS handled with internal error.",
    });
  }
}

/** Prefer shared Messaging Service if present; else tenant MS; else direct from. */
async function getSendParams(
  userId: string,
  _toNumber: string,
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
    from: fromNumber,
    to: fromNumber,
  } as Parameters<Twilio["messages"]["create"]>[0];
}
