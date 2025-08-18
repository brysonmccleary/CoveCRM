// /pages/api/twilio/inbound-sms.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import Message from "@/models/Message";
import twilio, { Twilio } from "twilio";
import twilioClient from "@/lib/twilioClient";
import { OpenAI } from "openai";
import { getTimezoneFromState } from "@/utils/timezone";
import { DateTime } from "luxon";
import { buffer } from "micro";
import axios from "axios";
import { sendAppointmentBookedEmail } from "@/lib/email"; // ✅ NEW

export const config = { api: { bodyParser: false } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  ""
).replace(/\/$/, "");
const SHARED_MESSAGING_SERVICE_SID =
  process.env.TWILIO_MESSAGING_SERVICE_SID || "";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";

// Dev-only webhook testing (bypass Twilio signature)
const ALLOW_DEV_TWILIO_TEST =
  process.env.ALLOW_LOCAL_TWILIO_TEST === "1" &&
  process.env.NODE_ENV !== "production";

// Human delay: 3–4 min; set AI_TEST_MODE=1 for 3–5s while testing
const AI_TEST_MODE = process.env.AI_TEST_MODE === "1";
function humanDelayMs() {
  return AI_TEST_MODE
    ? 3000 + Math.random() * 2000
    : 180000 + Math.random() * 60000;
}

// ---------- quiet hours (lead-local) ----------
const QUIET_START_HOUR = 21; // 9:00 PM
const QUIET_END_HOUR = 8; // 8:00 AM
const MIN_SCHEDULE_LEAD_MINUTES = 15;

// ---- State normalization + zone resolution (handles GA / Georgia / “washington dc”) ----
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
  // Eastern block (plus a couple of split defaults)
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

// normalize: lower, strip non-letters, collapse spaces
function normalizeStateInput(raw: string | undefined | null): string {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
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
    target = nowLocal.set({
      hour: QUIET_END_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
  } else {
    target = nowLocal
      .plus({ days: 1 })
      .set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
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
  return (
    ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"].some(
      (k) => t === k,
    ) ||
    t.includes("remove") ||
    t.includes("opt out")
  );
}
function isHelp(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  return t === "help" || t.includes("help");
}
function isStart(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  return t === "start" || t === "unstop";
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
  const zone = abbr
    ? TZ_ABBR[abbr]
    : zoneFromAnyState(state || "") || "America/New_York";
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

  const weekdays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
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
      const month = parseInt(m[1], 10),
        day = parseInt(m[2], 10);
      let h = parseInt(m[3], 10);
      const min = m[4] ? parseInt(m[4], 10) : 0;
      const ap = m[5];
      if (ap) {
        if (ap === "pm" && h < 12) h += 12;
        if (ap === "am" && h === 12) h = 0;
      }
      let dt = DateTime.fromObject(
        {
          year: now.year,
          month,
          day,
          hour: h,
          minute: min,
          second: 0,
          millisecond: 0,
        },
        { zone },
      );
      if (dt.isValid && dt < now) dt = dt.plus({ years: 1 });
      return dt.isValid ? dt.toISO() : null;
    }
  }

  const bare = text.match(timeRe);
  if (bare) {
    let h = parseInt(bare[1], 10);
    const min = bare[2] ? parseInt(bare[2], 10) : 0;
    const ap = bare[3];
    if (ap) {
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
    }
    const dt = now.set({ hour: h, minute: min, second: 0, millisecond: 0 });
    return dt.isValid ? dt.toISO() : null;
  }
  return null;
}

function extractTimeFromLastAI(history: any[], state?: string): string | null {
  const lastAI = [...(history || [])]
    .reverse()
    .find((m: any) => m.type === "ai");
  if (!lastAI?.text) return null;
  return extractRequestedISO(String(lastAI.text), state);
}

function computeContext(drips?: string[]) {
  const d = drips?.[0] || "";
  if (d.includes("mortgage")) return "mortgage protection";
  if (d.includes("veteran")) return "veteran life insurance";
  if (d.includes("iul")) return "retirement income protection";
  if (d.includes("final_expense")) return "final expense insurance";
  return "life insurance services";
}

type ConvState = "idle" | "awaiting_time" | "scheduled" | "qa";

interface LeadMemory {
  state: ConvState;
  lastAsked?: string[];
  apptISO?: string | null;
  apptText?: string | null;
  tz?: string;
  lastConfirmAtISO?: string | null;
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

async function extractIntentAndTimeLLM(input: {
  text: string;
  nowISO: string;
  tz: string;
}) {
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
    if (m.type === "inbound")
      msgs.push({ role: "user", content: String(m.text) });
    else if (m.type === "ai" || m.type === "outbound")
      msgs.push({ role: "assistant", content: String(m.text) });
  }
  return msgs.slice(-24); // last ~12 turns
}

// --- conversational reply
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
- Tone: friendly, concise, natural texting (contractions OK), 1–2 sentences, ~240 chars max.
- Do NOT introduce yourself or use any assistant/bot name. Do NOT sign messages.
- You can chat about anything briefly, but steer back to ${context} when relevant.
- Ask exactly one concrete follow-up to move things forward (ideally toward a time).
- If they propose a time, acknowledge and restate once clearly.
- Avoid repeating prior assistant lines; banned phrases: ${banned.join(" | ") || "(none)"}.
- No links, no emojis, no markdown.
- Local timezone: ${tz}.
`.trim();

  const chat = historyToChatMessages(history);
  chat.push({ role: "user", content: inboundText });

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    top_p: 0.9,
    presence_penalty: 0.4,
    frequency_penalty: 0.6,
    messages: [{ role: "system", content: sys }, ...chat],
  });

  const text = resp.choices?.[0]?.message?.content?.trim() || "";
  if (!text)
    return "Got it — what time works for a quick call today or tomorrow?";
  return text.replace(/\s+/g, " ").trim();
}

function normalizeWhen(
  datetimeText: string | null,
  nowISO: string,
  tz: string,
) {
  if (!datetimeText) return null;
  const iso = extractRequestedISO(datetimeText);
  if (iso) return { start: DateTime.fromISO(iso).setZone(tz) };
  return null;
}

// ---------- handler ----------
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed." });

  // Verify Twilio signature
  const raw = (await buffer(req)).toString();
  const params = new URLSearchParams(raw);
  const signature = (req.headers["x-twilio-signature"] || "") as string;
  const requestUrl = `${BASE_URL}/api/twilio/inbound-sms`;
  const valid = twilio.validateRequest(
    AUTH_TOKEN,
    signature,
    requestUrl,
    Object.fromEntries(params as any),
  );
  if (!valid) {
    if (ALLOW_DEV_TWILIO_TEST) {
      console.warn("⚠️ Dev bypass: Twilio signature validation skipped.");
    } else {
      console.warn("❌ Invalid Twilio signature on inbound-sms");
      return res.status(403).send("Invalid signature");
    }
  }

  try {
    await mongooseConnect();

    const fromNumber = params.get("From") || "";
    const toNumber = params.get("To") || "";
    const body = (params.get("Body") || "").trim();

    if (!fromNumber || !toNumber || !body)
      return res
        .status(200)
        .json({ message: "Missing required fields, acknowledged." });

    // user by inbound number we own
    const toDigits = normalizeDigits(toNumber);
    const user =
      (await User.findOne({ "numbers.phoneNumber": toNumber })) ||
      (await User.findOne({
        "numbers.phoneNumber": `+1${toDigits.slice(-10)}`,
      })) ||
      (await User.findOne({ "numbers.phoneNumber": `+${toDigits}` }));
    if (!user) {
      console.warn("⚠️ No user matched for To number:", toNumber);
      return res
        .status(200)
        .json({ message: "No user found for this number." });
    }

    // lead by sender
    const fromDigits = normalizeDigits(fromNumber);
    const last10 = fromDigits.slice(-10);
    const lead =
      (await Lead.findOne({
        userEmail: user.email,
        Phone: { $regex: last10 },
      })) ||
      (await Lead.findOne({ userEmail: user.email, Phone: `+1${last10}` })) ||
      (await Lead.findOne({
        userEmail: user.email,
        Phone: `+${fromDigits}`,
      })) ||
      (await Lead.findOne({
        userEmail: user.email,
        phone: { $regex: last10 },
      })) ||
      (await Lead.findOne({ userEmail: user.email, phone: `+1${last10}` })) ||
      (await Lead.findOne({ userEmail: user.email, phone: `+${fromDigits}` }));
    if (!lead) {
      console.warn("⚠️ No matching lead for inbound SMS from:", fromNumber);
      return res.status(200).json({ message: "Lead not found, acknowledged." });
    }

    const io = (res.socket as any)?.server?.io;

    // persist inbound
    const inboundEntry = {
      type: "inbound" as const,
      text: body,
      date: new Date(),
    };
    lead.interactionHistory = lead.interactionHistory || [];
    lead.interactionHistory.push(inboundEntry);
    lead.updatedAt = new Date();
    await lead.save();

    await Message.create({
      leadId: lead._id,
      userEmail: user.email,
      direction: "inbound",
      text: body,
      read: false,
      to: toNumber,
      from: fromNumber,
    });

    if (io)
      io.to(user.email).emit("message:new", {
        leadId: lead._id,
        ...inboundEntry,
      });

    // keywords
    if (isOptOut(body)) {
      lead.assignedDrips = [];
      (lead as any).dripProgress = [];
      lead.isAIEngaged = false;
      (lead as any).unsubscribed = true;
      await lead.save();
      await twilioClient.messages.create({
        ...(await getSendParams(String(user._id), toNumber, fromNumber)),
        body: "You've been unsubscribed and will no longer receive messages.",
      });
      return res.status(200).json({ message: "Lead opted out via keyword." });
    }
    if (isHelp(body)) {
      await twilioClient.messages.create({
        ...(await getSendParams(String(user._id), toNumber, fromNumber)),
        body: "Help: Reply STOP to unsubscribe. Msg&Data rates may apply.",
      });
      return res.status(200).json({ message: "Help handled." });
    }
    if (isStart(body)) {
      (lead as any).unsubscribed = false;
      await lead.save();
      await twilioClient.messages.create({
        ...(await getSendParams(String(user._id), toNumber, fromNumber)),
        body: "You’re opted-in again. Reply STOP to unsubscribe.",
      });
      return res.status(200).json({ message: "Start handled." });
    }

    // A2P gate (shared MS counts as approved)
    const a2p = await A2PProfile.findOne({ userId: String(user._id) });
    const usConversation = isUS(fromNumber) || isUS(toNumber);
    const approved =
      SHARED_MESSAGING_SERVICE_SID ||
      (a2p?.messagingReady && a2p?.messagingServiceSid);
    if (usConversation && !approved) {
      lead.interactionHistory.push({
        type: "inbound",
        text: "[note] Auto-reply suppressed: A2P not approved yet.",
        date: new Date(),
      });
      await lead.save();
      if (io)
        io.to(user.email).emit("message:new", {
          leadId: lead._id,
          type: "inbound",
          text: "[note] Auto-reply suppressed: A2P not approved yet.",
          date: new Date(),
        });
      return res
        .status(200)
        .json({ message: "A2P not approved; no auto-reply sent." });
    }
    if ((lead as any).unsubscribed)
      return res
        .status(200)
        .json({ message: "Lead unsubscribed; no auto-reply." });

    // If this reply is from a retention campaign, don't engage AI
    const assignedDrips = lead.assignedDrips || [];
    const isClientRetention = assignedDrips.some((id) =>
      id.includes("client_retention"),
    );
    if (isClientRetention)
      return res
        .status(200)
        .json({ message: "Client retention reply — no AI engagement." });

    // ✅ Cancel drips & engage AI
    lead.assignedDrips = [];
    (lead as any).dripProgress = [];
    lead.isAIEngaged = true;

    // ----- memory -----
    const tz = pickLeadZone(lead);
    const nowISO = DateTime.utc().toISO();
    const memory: LeadMemory = {
      state: ((lead as any).aiMemory?.state as ConvState) || "idle",
      lastAsked: (lead as any).aiMemory?.lastAsked || [],
      apptISO: (lead as any).aiMemory?.apptISO || null,
      apptText: (lead as any).aiMemory?.apptText || null,
      tz,
      lastConfirmAtISO: (lead as any).aiMemory?.lastConfirmAtISO || null,
    };

    // ===== decide next reply =====
    let aiReply = "When’s a good time today or tomorrow for a quick chat?";
    // normalize state for parsing
    const stateCanon = normalizeStateInput(
      lead.State || (lead as any).state || "",
    );
    // 1) deterministic parse
    let requestedISO: string | null = extractRequestedISO(body, stateCanon);
    // 2) “works” confirmations bind to last AI proposal
    if (!requestedISO && containsConfirmation(body)) {
      requestedISO =
        extractTimeFromLastAI(lead.interactionHistory || [], stateCanon) ||
        (lead as any).aiLastProposedISO ||
        null;
    }

    // 3) conversational fallback
    if (!requestedISO) {
      try {
        const ex = await extractIntentAndTimeLLM({ text: body, nowISO, tz });
        const norm = normalizeWhen(ex.datetime_text, nowISO, tz);
        if (norm?.start) requestedISO = norm.start.toISO();

        if (!requestedISO) {
          const context = computeContext(lead.assignedDrips);
          if (ex.intent === "ask_duration") {
            aiReply = `It’s quick—about 10–15 minutes. What time works best for you—later today or tomorrow?`;
            memory.state = "qa";
          } else if (ex.intent === "ask_cost") {
            aiReply = `No cost to chat—just review options and you decide. What time works best—today or tomorrow?`;
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
            if (!askedRecently(memory, "chat_followup"))
              pushAsked(memory, "chat_followup");
            memory.state = "awaiting_time";
          }
        }
      } catch {
        memory.state = "awaiting_time";
        const lastAI = [...(lead.interactionHistory || [])]
          .reverse()
          .find((m: any) => m.type === "ai");
        const v = `What time works for you—today or tomorrow? You can reply like “tomorrow 3:00 pm”.`;
        aiReply =
          lastAI?.text?.trim() === v
            ? `Shoot me a time that works (e.g., “tomorrow 3:00 pm”) and I’ll text a confirmation.`
            : v;
      }
    }

    // 4) If we have a concrete time now, confirm + book
    if (requestedISO) {
      const zone = tz;
      const clientTime = DateTime.fromISO(requestedISO, { zone }).set({
        second: 0,
        millisecond: 0,
      });

      const alreadyConfirmedSame =
        (lead as any).aiLastConfirmedISO &&
        DateTime.fromISO((lead as any).aiLastConfirmedISO).toISO() ===
          clientTime.toISO();

      const recentConfirmCooldown =
        memory.lastConfirmAtISO &&
        Date.now() - Date.parse(memory.lastConfirmAtISO) < 10 * 60 * 1000;

      if (alreadyConfirmedSame || recentConfirmCooldown) {
        aiReply = `All set — you’re on my schedule. Talk soon!`;
      } else {
        try {
          const bookingPayload = {
            agentEmail: (lead.userEmail || user.email || "").toLowerCase(),
            name:
              lead["First Name"] ||
              (lead as any)["First"] ||
              (lead as any)["Name"] ||
              "Client",
            phone: lead.Phone || (lead as any).phone || fromNumber,
            email: lead.Email || (lead as any).email || "",
            time: clientTime.toISO(),
            state: stateCanon || "AZ",
            durationMinutes: 30,
            notes: "Auto-booked via inbound SMS",
          };

          console.log("📌 Booking payload ->", bookingPayload);

          const bookingRes = await axios.post(
            `${BASE_URL}/api/google/calendar/book-appointment`,
            bookingPayload,
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

            // ✅ NEW: email the agent
            try {
              const fullName =
                `${lead["First Name"] || ""} ${(lead as any)["Last Name"] || (lead as any)["Last"] || ""}`.trim() ||
                "Client";
              await sendAppointmentBookedEmail({
                to: (lead.userEmail || user.email || "").toLowerCase(),
                agentName: (user as any)?.name || user.email,
                leadName: fullName,
                phone: lead.Phone || (lead as any).phone || fromNumber,
                state: stateCanon || "",
                timeISO: clientTime.toISO()!,
                timezone: clientTime.offsetNameShort,
                source: "AI",
                eventLink: (bookingRes.data?.event?.htmlLink ||
                  bookingRes.data?.htmlLink ||
                  "") as string | undefined,
              });
            } catch (e) {
              console.warn("Email send failed (appointment):", e);
            }
          } else {
            console.warn(
              "⚠️ Booking API responded but not success:",
              bookingRes.data,
            );
          }
        } catch (e) {
          console.error(
            "⚠️ Booking API failed (proceeding to confirm by SMS):",
            (e as any)?.response?.data || e,
          );
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

    // Save memory snapshot back on lead
    (lead as any).aiMemory = memory;
    lead.aiLastResponseAt = new Date();
    await lead.save();

    // Delayed send (human-like)
    setTimeout(async () => {
      try {
        const fresh = await Lead.findById(lead._id);
        if (!fresh) return;

        if (
          fresh.aiLastResponseAt &&
          Date.now() - new Date(fresh.aiLastResponseAt).getTime() <
            2 * 60 * 1000
        ) {
          console.log("⏳ Skipping AI reply (cool-down).");
          return;
        }
        if (
          (fresh as any).appointmentTime &&
          !(fresh as any).aiLastConfirmedISO
        ) {
          console.log("✅ Appointment already set; skipping nudge.");
          return;
        }

        const lastAI = [...(fresh.interactionHistory || [])]
          .reverse()
          .find((m: any) => m.type === "ai");
        if (lastAI && lastAI.text?.trim() === aiReply.trim()) {
          console.log("🔁 Same AI content as last time — not sending.");
          return;
        }

        const zone = pickLeadZone(fresh);
        const { isQuiet, scheduledAt } = computeQuietHoursScheduling(zone);

        const baseParams = await getSendParams(
          String(user._id),
          toNumber,
          fromNumber,
        );
        const params: Parameters<Twilio["messages"]["create"]>[0] = {
          ...baseParams,
          body: aiReply,
        };

        const canSchedule = "messagingServiceSid" in params;

        if (isQuiet && scheduledAt && canSchedule) {
          (params as any).scheduleType = "fixed";
          (params as any).sendAt = scheduledAt.toISOString();
        } else if (isQuiet && !canSchedule) {
          console.warn(
            "⚠️ Quiet hours detected but cannot schedule without Messaging Service SID. Sending immediately.",
          );
        }

        const aiEntry = {
          type: "ai" as const,
          text: aiReply,
          date: new Date(),
        };
        fresh.interactionHistory = fresh.interactionHistory || [];
        fresh.interactionHistory.push(aiEntry);
        fresh.aiLastResponseAt = new Date();
        await fresh.save();

        const twilioMsg = await twilioClient.messages.create(params);

        await Message.create({
          leadId: fresh._id,
          userEmail: user.email,
          direction: "outbound",
          text: aiReply,
          read: true,
          to: fromNumber,
          from: toNumber,
          sid: (twilioMsg as any)?.sid,
          status: (twilioMsg as any)?.status,
          sentAt:
            isQuiet && scheduledAt && canSchedule ? scheduledAt : new Date(),
          fromServiceSid: (params as any).messagingServiceSid,
        });

        if (io)
          io.to(user.email).emit("message:new", {
            leadId: fresh._id,
            ...aiEntry,
          });

        if (isQuiet && scheduledAt && canSchedule) {
          console.log(
            `🕘 Quiet hours: scheduled AI reply to ${fromNumber} at ${scheduledAt.toISOString()} (${zone}) | SID: ${(twilioMsg as any)?.sid}`,
          );
        } else {
          console.log(
            `🤖 AI reply sent to ${fromNumber} | SID: ${(twilioMsg as any)?.sid}`,
          );
        }
      } catch (err) {
        console.error("❌ Delayed send failed:", err);
      }
    }, humanDelayMs());

    return res
      .status(200)
      .json({ message: "Inbound received; AI reply scheduled." });
  } catch (error: any) {
    console.error("❌ SMS handler failed:", error);
    return res
      .status(200)
      .json({ message: "Inbound SMS handled with internal error." });
  }
}

/** Prefer shared Messaging Service if present; else tenant MS; else direct from */
async function getSendParams(
  userId: string,
  toNumber: string,
  fromNumber: string,
) {
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    return {
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      to: fromNumber,
    } as Parameters<Twilio["messages"]["create"]>[0];
  }
  const a2p = await A2PProfile.findOne({ userId });
  if (a2p?.messagingServiceSid) {
    return {
      messagingServiceSid: a2p.messagingServiceSid,
      to: fromNumber,
    } as Parameters<Twilio["messages"]["create"]>[0];
  }
  // NOTE: Scheduling is NOT supported when sending with a bare "from" number.
  return { from: toNumber, to: fromNumber } as Parameters<
    Twilio["messages"]["create"]
  >[0];
}
