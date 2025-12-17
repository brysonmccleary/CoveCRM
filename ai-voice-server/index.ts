// ai-voice-server/index.ts
import http, { IncomingMessage, ServerResponse } from "http";
import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch";
import { Buffer } from "buffer";

/**
 * ENV + config
 */
const PORT = process.env.PORT
  ? Number(process.env.PORT)
  : process.env.AI_VOICE_SERVER_PORT
  ? Number(process.env.AI_VOICE_SERVER_PORT)
  : 4000;

const COVECRM_BASE_URL =
  process.env.COVECRM_BASE_URL || "https://www.covecrm.com";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const AI_DIALER_AGENT_KEY = process.env.AI_DIALER_AGENT_KEY || "";

// Your internal vendor-cost estimate (Twilio + OpenAI)
const AI_DIALER_VENDOR_COST_PER_MIN_USD = Number(
  process.env.AI_DIALER_VENDOR_COST_PER_MIN_USD || "0"
);

// OpenAI Realtime
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview";

// Endpoints
const BOOK_APPOINTMENT_URL = new URL(
  "/api/ai-calls/book-appointment",
  COVECRM_BASE_URL
).toString();
const OUTCOME_URL = new URL(
  "/api/ai-calls/outcome",
  COVECRM_BASE_URL
).toString();
const USAGE_URL = new URL("/api/ai-calls/usage", COVECRM_BASE_URL).toString();

/**
 * Twilio <Stream> message types
 */
type TwilioStreamMessage =
  | TwilioStartEvent
  | TwilioMediaEvent
  | TwilioStopEvent
  | TwilioOtherEvent;

type TwilioStartEvent = {
  event: "start";
  streamSid: string;
  start: {
    accountSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
};

type TwilioMediaEvent = {
  event: "media";
  streamSid: string;
  media: {
    payload: string; // base64 μ-law 8k audio (g711_ulaw)
    track?: string;
  };
};

type TwilioStopEvent = {
  event: "stop";
  streamSid: string;
  stop: {
    accountSid: string;
    callSid: string;
  };
};

type TwilioOtherEvent = {
  event: string;
  [key: string]: any;
};

type AICallContext = {
  userEmail: string;
  sessionId: string;
  leadId: string;
  agentName: string;
  agentTimeZone: string;
  clientFirstName: string;
  clientLastName: string;
  clientState?: string;
  clientPhone?: string;
  clientEmail?: string;
  clientNotes?: string;
  scriptKey: string;
  voiceKey: string;
  voiceProfile: {
    aiName: string;
    openAiVoiceId: string;
    style: string;
  };

  // ✅ Optional AMD hint from CoveCRM (AnswerBy=human/machine/unknown etc)
  answeredBy?: string;

  raw: {
    session: any;
    user: any;
    lead: any;
  };
};

type CallPhase = "init" | "awaiting_greeting_reply" | "in_call" | "ended";

type CallState = {
  streamSid: string;
  callSid: string;
  context?: AICallContext;

  openAiWs?: WebSocket;

  // ✅ We are "ready" ONLY after OpenAI confirms session.updated (not session.created)
  openAiReady?: boolean;

  // ✅ Whether we've seen session.updated after our update
  openAiConfigured?: boolean;

  // inbound buffering (Twilio -> OpenAI) while not ready
  pendingAudioFrames: string[];

  finalOutcomeSent?: boolean;

  callStartedAtMs?: number;
  billedUsageSent?: boolean;

  debugLoggedFirstMedia?: boolean;
  debugLoggedFirstOutputAudio?: boolean;

  // TURN + COST CONTROL
  waitingForResponse?: boolean;
  aiSpeaking?: boolean;
  userAudioMsBuffered?: number;

  // greeting guard
  initialGreetingQueued?: boolean;

  // ✅ strict call phase to enforce “greet → WAIT → script”
  phase?: CallPhase;

  // diagnostics
  debugLoggedMissingTrack?: boolean;

  // ✅ Outbound pacing buffer (μ-law bytes)
  outboundMuLawBuffer?: Buffer;
  outboundPacerTimer?: NodeJS.Timeout | null;
  outboundOpenAiDone?: boolean;

  // ✅ voicemail skip safety
  voicemailSkipArmed?: boolean;
};

const calls = new Map<WebSocket, CallState>();

/**
 * ✅ Canonical script normalization (defensive)
 */
function normalizeScriptKey(raw: any): string {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "mortgage_protection";

  if (v === "mortgage" || v === "mortgageprotect" || v === "mp") {
    return "mortgage_protection";
  }

  if (
    v === "final_expense" ||
    v === "finalexpense" ||
    v === "fe" ||
    v === "fex" ||
    v === "fex_default" ||
    v === "final_expense_default"
  ) {
    return "final_expense";
  }

  if (v === "iul" || v === "iul_leads" || v === "iul_cash_value") {
    return "iul_cash_value";
  }

  if (v === "veterans" || v === "veteran" || v === "veteran_leads") {
    return "veteran_leads";
  }

  if (v === "trucker" || v === "truckers" || v === "trucker_leads") {
    return "trucker_leads";
  }

  if (v === "generic" || v === "life" || v === "generic_life") {
    return "generic_life";
  }

  if (
    v === "mortgage_protection" ||
    v === "final_expense" ||
    v === "iul_cash_value" ||
    v === "veteran_leads" ||
    v === "trucker_leads" ||
    v === "generic_life"
  ) {
    return v;
  }

  return "mortgage_protection";
}

/**
 * PCM16 (24k) → μ-law 8k (base64) for Twilio
 * (audio path UNCHANGED)
 */
function pcm16ToMulawBase64(pcm16Base64: string): string {
  if (!pcm16Base64) return "";

  const pcmBuf = Buffer.from(pcm16Base64, "base64");
  if (pcmBuf.length < 2) return "";

  const sampleCount = Math.floor(pcmBuf.length / 2);
  if (sampleCount <= 0) return "";

  const outSampleCount = Math.ceil(sampleCount / 3);
  const mulawBytes = Buffer.alloc(outSampleCount);

  const BIAS = 0x84;
  const CLIP = 32635;

  const linearToMulaw = (sample: number): number => {
    let sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample = sample + BIAS;

    let exponent = 7;
    for (
      let expMask = 0x4000;
      (sample & expMask) === 0 && exponent > 0;
      expMask >>= 1
    ) {
      exponent--;
    }

    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    let mu = ~(sign | (exponent << 4) | mantissa);
    return mu & 0xff;
  };

  let outIndex = 0;
  for (let i = 0; i < sampleCount && outIndex < outSampleCount; i += 3) {
    const offset = i * 2;
    if (offset + 1 >= pcmBuf.length) break;
    const sample = pcmBuf.readInt16LE(offset);
    const mu = linearToMulaw(sample);
    mulawBytes[outIndex++] = mu;
  }

  if (outIndex < outSampleCount) {
    return mulawBytes.slice(0, outIndex).toString("base64");
  }
  return mulawBytes.toString("base64");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cut-out guard helpers
 */
function setAiSpeaking(state: CallState, next: boolean, reason: string) {
  const prev = !!state.aiSpeaking;
  if (prev === next) return;
  state.aiSpeaking = next;
  console.log("[AI-VOICE] aiSpeaking =", next, "|", reason);
}

function setWaitingForResponse(state: CallState, next: boolean, reason: string) {
  const prev = !!state.waitingForResponse;
  if (prev === next) return;
  state.waitingForResponse = next;
  console.log("[AI-VOICE] waitingForResponse =", next, "|", reason);
}

/**
 * ✅ Outbound pacing (Twilio wants ~20ms μ-law frames)
 * μ-law @ 8k: 20ms = 160 bytes.
 */
const TWILIO_FRAME_BYTES = 160;
const TWILIO_FRAME_MS = 20;

function ensureOutboundPacer(twilioWs: WebSocket, state: CallState) {
  if (state.outboundPacerTimer) return;

  state.outboundPacerTimer = setInterval(() => {
    try {
      const live = calls.get(twilioWs);
      if (!live) return;

      const buf = live.outboundMuLawBuffer || Buffer.alloc(0);

      if (buf.length >= TWILIO_FRAME_BYTES) {
        const frame = buf.subarray(0, TWILIO_FRAME_BYTES);
        live.outboundMuLawBuffer = buf.subarray(TWILIO_FRAME_BYTES);

        const payload = frame.toString("base64");

        twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid: live.streamSid,
            media: { payload },
          })
        );
      } else {
        if (live.outboundOpenAiDone) {
          if ((live.outboundMuLawBuffer?.length || 0) < TWILIO_FRAME_BYTES) {
            live.outboundMuLawBuffer = Buffer.alloc(0);
            stopOutboundPacer(twilioWs, live, "buffer drained after OpenAI done");
            setAiSpeaking(live, false, "pacer drained");
          }
        }
      }
    } catch (err: any) {
      console.error("[AI-VOICE][PACE] error:", err?.message || err);
    }
  }, TWILIO_FRAME_MS);

  console.log("[AI-VOICE][PACE] started 20ms outbound pusher");
}

function stopOutboundPacer(
  twilioWs: WebSocket,
  state: CallState,
  reason: string
) {
  if (state.outboundPacerTimer) {
    try {
      clearInterval(state.outboundPacerTimer);
    } catch {}
    state.outboundPacerTimer = null;
    console.log("[AI-VOICE][PACE] stopped |", reason);
  }
}

/**
 * ✅ Voicemail detection helpers
 */
function isVoicemailAnsweredBy(answeredByRaw?: string): boolean {
  const v = String(answeredByRaw || "").trim().toLowerCase();
  if (!v) return false;
  return v.includes("machine") || v.includes("fax") || v.includes("voicemail");
}

async function refreshAnsweredByFromCoveCRM(
  state: CallState,
  reason: string
): Promise<string> {
  try {
    if (!state.context) return "";
    if (!AI_DIALER_CRON_KEY) return "";

    const sessionId = state.context.sessionId;
    const leadId = state.context.leadId;
    const callSid = state.callSid;

    if (!sessionId || !leadId || !callSid) return "";

    const url = new URL("/api/ai-calls/context", COVECRM_BASE_URL);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("leadId", leadId);
    url.searchParams.set("key", AI_DIALER_CRON_KEY);
    url.searchParams.set("callSid", callSid);

    const resp = await fetch(url.toString());
    const json: any = await resp.json().catch(() => ({}));

    if (!resp.ok || !json?.ok || !json?.context) return "";

    const answeredBy = String(json.context.answeredBy || "").trim();
    if (answeredBy) {
      state.context.answeredBy = answeredBy;
      console.log("[AI-VOICE] refreshed AnsweredBy from CoveCRM:", {
        callSid,
        answeredBy,
        reason,
      });
      return answeredBy;
    }

    return "";
  } catch (err: any) {
    console.warn("[AI-VOICE] refreshAnsweredBy failed (non-blocking):", {
      callSid: state.callSid,
      reason,
      error: err?.message || err,
    });
    return "";
  }
}

function safelyCloseOpenAi(state: CallState, why: string) {
  try {
    state.outboundOpenAiDone = true;
    state.outboundMuLawBuffer = Buffer.alloc(0);
    state.openAiReady = false;
    state.openAiConfigured = false;
    state.phase = "ended";
    setWaitingForResponse(state, false, `close openai (${why})`);
    setAiSpeaking(state, false, `close openai (${why})`);

    if (state.openAiWs) {
      try {
        state.openAiWs.close();
      } catch {}
      state.openAiWs = undefined;
    }
  } catch {}
}

/**
 * ✅ BOOKING-ONLY SCRIPTS (NO PRESENTATION / NO UNDERWRITING / NO RATES / NO HEALTH)
 * Goal: book the appointment, nothing else.
 */
function getSelectedScriptText(ctx: AICallContext): string {
  const aiName = (ctx.voiceProfile.aiName || "Alex").trim() || "Alex";
  const clientRaw = (ctx.clientFirstName || "").trim();
  const client = clientRaw ? clientRaw : "there";
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();
  const scriptKey = normalizeScriptKey(ctx.scriptKey);

  const SCRIPT_MORTGAGE = `
BOOKING SCRIPT — MORTGAGE PROTECTION (FOLLOW IN ORDER)

STEP 1 (FIRST script turn AFTER the system greeting + lead responds)
Say: "Hey ${client}, ${client} it’s just ${aiName}, how’s your day going?"
STOP. WAIT.

STEP 2
Say: "I was hoping you could help me out. I'm reaching out regarding the request you sent in a while back for mortgage protection information. Did you end up getting the coverage in place?"
STOP. WAIT.

IF THEY SAY "YES" / "I GOT IT"
Say: "Perfect. Real quick, was that for just you, or a spouse as well?"
STOP. WAIT.
Then say: "Got it. My job is just to get you scheduled so ${agent} can double-check it matches what you wanted. Would later today or tomorrow be better — daytime or evening?"
STOP. WAIT.

IF THEY SAY "NO" / "NOT YET"
Say: "No worries. Was this to cover just yourself, or a spouse as well?"
STOP. WAIT.
Then ask: "Was your main goal to help protect the mortgage if something happened, or were you just wanting to see what options were out there for the family?"
STOP. WAIT.
Then ask: "Do you mind walking me through what prompted you to reach out in the first place?"
STOP. WAIT.

BOOK (CLOSE)
Say: "Perfect — my job is just to get you scheduled. ${agent} is the licensed agent who will go over everything with you. Would you have more time later today or tomorrow — daytime or evening?"
STOP. WAIT.

CONFIRM
If they pick a window, say: "Okay perfect. I’ll put you down for a quick call with ${agent} around that time. Does that work?"
STOP. WAIT.

CLOSE
Say: "Awesome. I’ll have ${agent} call you around then. Stay blessed."
`.trim();

  const SCRIPT_FINAL_EXPENSE = `
BOOKING SCRIPT — FINAL EXPENSE (FOLLOW IN ORDER)

STEP 1 (FIRST script turn AFTER the system greeting + lead responds)
Say: "Hey ${client}, ${client} it’s just ${aiName}, how’s your day going?"
STOP. WAIT.

STEP 2
Say: "I was hoping you could help me out. I'm reaching out regarding the request you sent in for final expense coverage information. Did you end up getting the coverage in place?"
STOP. WAIT.

IF THEY SAY "YES"
Say: "Perfect. Real quick, was that for just you, or were you also thinking about a spouse?"
STOP. WAIT.
Then say: "Got it. My job is just to get you scheduled so ${agent} can double-check it matches what you wanted. Would later today or tomorrow be better — daytime or evening?"
STOP. WAIT.

IF THEY SAY "NO"
Say: "No worries. Would the coverage be for just yourself, or a spouse as well?"
STOP. WAIT.
Then ask: "Was your main goal more funeral and final arrangements, or just wanting to see what options were out there for the family?"
STOP. WAIT.
Then ask: "Do you mind walking me through what prompted you to reach out?"
STOP. WAIT.

BOOK (CLOSE)
Say: "Perfect — my job is just to get you scheduled. ${agent} is the licensed agent who will go over everything with you. Would later today or tomorrow be better — daytime or evening?"
STOP. WAIT.

CONFIRM
Say: "Okay perfect. I’ll put you down for a quick call with ${agent} around that time. Does that work?"
STOP. WAIT.

CLOSE
Say: "Awesome. I’ll have ${agent} call you around then. Stay blessed."
`.trim();

  const SCRIPT_IUL = `
BOOKING SCRIPT — CASH VALUE / IUL (FOLLOW IN ORDER)

STEP 1 (FIRST script turn AFTER the system greeting + lead responds)
Say: "Hey ${client}, ${client} it’s just ${aiName}, how’s your day going?"
STOP. WAIT.

STEP 2
Say: "I'm reaching out in regards to the request that you submitted to get the information on the cash growing life insurance — the indexed universal life options. Do you remember doing that?"
STOP. WAIT.

IF THEY SAY "YES"
Say: "Awesome. When you were looking into this, was your main priority more the cash growth side, or more the protection side for the family?"
STOP. WAIT.
Then ask: "Would the coverage be for just yourself, or did you have a spouse and/or kids in mind too?"
STOP. WAIT.

IF THEY SAY "NO" / "I DON'T REMEMBER"
Say: "No worries. It was just a request for information on cash value life insurance options. Was that for just you, or a spouse as well?"
STOP. WAIT.

BOOK (CLOSE)
Say: "Perfect — my job is just to get you scheduled. ${agent} is the licensed agent who will go over the details with you on a quick call. Would later today or tomorrow be better — daytime or evening?"
STOP. WAIT.

CONFIRM
Say: "Okay perfect. I’ll put you down for a quick call with ${agent} around that time. Does that work?"
STOP. WAIT.

CLOSE
Say: "Awesome. I’ll have ${agent} call you around then. Stay blessed."
`.trim();

  const SCRIPT_VETERAN = `
BOOKING SCRIPT — VETERAN LEADS (FOLLOW IN ORDER)

STEP 1 (FIRST script turn AFTER the system greeting + lead responds)
Say: "Hey ${client}, ${client} it’s just ${aiName}, how’s your day going?"
STOP. WAIT.

STEP 2
Say: "I was just reaching out about the veteran life insurance you were looking into. Were you looking to get the coverage on just yourself, or a spouse as well?"
STOP. WAIT.

BOOK (CLOSE)
Say: "Perfect — my job is just to get you scheduled. ${agent} is the licensed agent who will go over everything with you. Would later today or tomorrow be better — daytime or evening?"
STOP. WAIT.

CONFIRM
Say: "Okay perfect. I’ll put you down for a quick call with ${agent} around that time. Does that work?"
STOP. WAIT.

CLOSE
Say: "Awesome. I’ll have ${agent} call you around then. Stay blessed."
`.trim();

  const SCRIPT_GENERIC = `
BOOKING SCRIPT — GENERIC LIFE (FOLLOW IN ORDER)

STEP 1 (FIRST script turn AFTER the system greeting + lead responds)
Say: "Hey ${client}, ${client} it’s just ${aiName}, how’s your day going?"
STOP. WAIT.

STEP 2
Say: "I was hoping you could help me out. I'm reaching out regarding the request you sent in for life insurance information. Did you end up getting anything in place?"
STOP. WAIT.

IF THEY SAY "YES"
Say: "Perfect. Was that for just you, or a spouse as well?"
STOP. WAIT.
Then say: "Got it. My job is just to get you scheduled so ${agent} can double-check it matches what you wanted. Would later today or tomorrow be better — daytime or evening?"
STOP. WAIT.

IF THEY SAY "NO"
Say: "No worries. Would the coverage be for just yourself, or a spouse as well?"
STOP. WAIT.
Then ask: "What were your main goals — funeral and final arrangements, leaving money behind for the family, or covering a mortgage?"
STOP. WAIT.
Then ask: "Do you mind walking me through what prompted you to reach out?"
STOP. WAIT.

BOOK (CLOSE)
Say: "Perfect — my job is just to get you scheduled. ${agent} is the licensed agent who will go over everything with you. Would later today or tomorrow be better — daytime or evening?"
STOP. WAIT.

CONFIRM
Say: "Okay perfect. I’ll put you down for a quick call with ${agent} around that time. Does that work?"
STOP. WAIT.

CLOSE
Say: "Awesome. I’ll have ${agent} call you around then. Stay blessed."
`.trim();

  if (scriptKey === "mortgage_protection") return SCRIPT_MORTGAGE;
  if (scriptKey === "final_expense") return SCRIPT_FINAL_EXPENSE;
  if (scriptKey === "iul_cash_value") return SCRIPT_IUL;
  if (scriptKey === "veteran_leads") return SCRIPT_VETERAN;
  if (scriptKey === "trucker_leads") return SCRIPT_GENERIC;
  if (scriptKey === "generic_life") return SCRIPT_GENERIC;

  return SCRIPT_MORTGAGE;
}

/**
 * ✅ Rebuttals / objection handling — booking-only.
 */
function getRebuttalsBlock(ctx: AICallContext): string {
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();
  const clientRaw = (ctx.clientFirstName || "").trim();
  const client = clientRaw ? clientRaw : "there";

  return `
REBUTTALS (USE ONLY IF NEEDED — THEN GO RIGHT BACK TO BOOKING)

RULES
- One rebuttal at a time.
- Keep it short (1–2 sentences).
- Then ask again: "Would later today or tomorrow work better — daytime or evening?"
- Never mention rates, underwriting, carriers, approvals, eligibility, age, health.
- Never introduce any other scenario (travel, resorts, healthcare, utilities, etc.).
- Never apologize. Never mention scripts/prompts. Never acknowledge mistakes.

OBJECTION: "I don’t have time / I’m at work"
REBUTTAL: "Totally understand. That’s why I’m just scheduling — it’ll be a short call with ${agent}. Would later today or tomorrow be better — daytime or evening?"

OBJECTION: "Just send it / just text me"
REBUTTAL: "I can, but it’s usually easier to schedule a quick call so you don’t have to go back and forth. Would later today or tomorrow be better — daytime or evening?"

OBJECTION: "I already have coverage"
REBUTTAL: "Perfect — this is just to make sure it still lines up with what you wanted. Would later today or tomorrow be better — daytime or evening?"

OBJECTION: "How much is it?"
REBUTTAL: "Good question — ${agent} covers that on the quick call because it depends on what you want it to do. Would later today or tomorrow be better — daytime or evening?"

OBJECTION: "I’m not interested"
REBUTTAL: "No worries — just so I don’t waste your time, did you mean you don’t want any coverage at all, or you just don’t want a call right now?"
STOP. WAIT.
- If they say "no call right now": "All good. Would later today or tomorrow be better — daytime or evening?"
- If they say "no coverage": "Got it. I’ll mark this as not interested. Stay blessed."

OBJECTION: "I don’t remember filling anything out"
REBUTTAL: "No worries — it was just a request for information on life insurance. Was that for just you, or a spouse as well?"
STOP. WAIT.

OBJECTION: "Is this a scam?"
REBUTTAL: "I understand. This is just a scheduling call tied to your life insurance request. ${agent} will explain everything clearly on the phone. Would later today or tomorrow be better — daytime or evening?"

OBJECTION: "Call my spouse"
REBUTTAL: "Absolutely — we can include them. What time is best when you’re both available — later today or tomorrow?"
STOP. WAIT.
`.trim();
}

function getScriptBlock(ctx: AICallContext): string {
  const aiName = (ctx.voiceProfile.aiName || "Alex").trim() || "Alex";
  const clientRaw = (ctx.clientFirstName || "").trim();
  const client = clientRaw ? clientRaw : "there";
  const scriptKey = normalizeScriptKey(ctx.scriptKey);

  const HARD_LOCKS = `
HARD ENGLISH LOCK (NON-NEGOTIABLE)
- Speak ONLY English.

HARD NAME LOCK (NON-NEGOTIABLE)
- The ONLY name you may use for the lead is exactly: "${client}"
- If the lead name is missing, use exactly: "there"
- NEVER invent or guess a name. NEVER use any other name.

HARD SCOPE LOCK (NON-NEGOTIABLE)
- This call is ONLY about a LIFE INSURANCE request that the lead submitted.
- Allowed topics ONLY: mortgage protection, final expense, cash value/IUL, veteran life insurance programs.
- You MUST NEVER mention or discuss: resorts, hotels, vacations, timeshares, travel, energy plans, utilities, solar, Medicare, health insurance, ACA/Obamacare, auto insurance, home insurance, cable/internet, phone plans, warranties, debt relief, credit repair, alarms, security systems, banking, loans.

ABSOLUTE BEHAVIOR LOCK (NON-NEGOTIABLE)
- You must NEVER apologize.
- You must NEVER mention “scripts”, “prompts”, “wrong call”, or “wrong number”.
- If you are about to say anything outside the allowed scope, DO NOT SAY IT.
  Instead, immediately continue with the next line from the BOOKING SCRIPT below.

BOOKING-ONLY LOCK (NON-NEGOTIABLE)
- You are a scheduling assistant (NOT a licensed agent).
- Do NOT say you are an underwriter.
- Do NOT mention rates, pricing details, carriers, approvals, eligibility, medical/health questions, age questions.
- Do NOT ask DOB, SSN, banking, pen & paper, license numbers.
- Your ONLY goal is to book a phone appointment.

TURN DISCIPLINE (NON-NEGOTIABLE)
- After you ask ANY question, you MUST STOP talking and WAIT for the lead.
- Do NOT fill silence. Do NOT keep explaining.
- Keep each speaking turn 1–2 sentences unless a rebuttal requires one extra sentence.
`.trim();

  const selectedScript = getSelectedScriptText(ctx);
  const rebuttals = getRebuttalsBlock(ctx);

  return [
    `AI NAME: ${aiName}`,
    `SCRIPT KEY: ${scriptKey}`,
    "",
    HARD_LOCKS,
    "",
    "====================",
    "BOOKING SCRIPT (FOLLOW EXACTLY)",
    "====================",
    selectedScript,
    "",
    "====================",
    "REBUTTALS (IF NEEDED)",
    "====================",
    rebuttals,
  ].join("\n");
}

/**
 * ✅ Strict system greeting: MUST stop and wait.
 */
function buildGreetingInstructions(ctx: AICallContext): string {
  const aiName = (ctx.voiceProfile.aiName || "Alex").trim() || "Alex";
  const clientName = (ctx.clientFirstName || "").trim() || "there";

  return [
    'HARD ENGLISH LOCK: Speak ONLY English.',
    'HARD SCOPE LOCK: This call is ONLY about a LIFE INSURANCE request. Do NOT mention any other product.',
    'HARD NAME LOCK: You may ONLY use the lead name exactly as provided. If missing, say "there". Never invent names.',
    "",
    "SYSTEM GREETING (NON-NEGOTIABLE):",
    `- Your first words MUST start with: "Hey ${clientName}."`,
    "- Keep it SHORT: 1 sentence greeting + 1 simple question.",
    `- Say exactly: "Hey ${clientName}. This is ${aiName}. Can you hear me okay?"`,
    "- After the question, STOP talking and WAIT for the lead to respond.",
    "- Do NOT begin the booking script on this greeting turn.",
  ].join("\n");
}

/**
 * System prompt – HARD locks + BOOKING script + rebuttals.
 */
function buildSystemPrompt(ctx: AICallContext): string {
  const aiName = (ctx.voiceProfile.aiName || "Alex").trim() || "Alex";
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();
  const scriptKey = normalizeScriptKey(ctx.scriptKey);
  const leadName = (ctx.clientFirstName || "").trim() || "there";

  const base = `
You are ${aiName}, a phone appointment-setting assistant calling on behalf of licensed life insurance agent ${agent}.
You are calm, confident, and human-sounding.

HARD ENGLISH LOCK (NON-NEGOTIABLE)
- Speak ONLY English.

HARD NAME LOCK (NON-NEGOTIABLE)
- The ONLY name you may use for the lead is exactly: "${leadName}"
- If missing, use exactly: "there"
- NEVER invent or guess a name.

HARD SCOPE LOCK (NON-NEGOTIABLE)
- This call is ONLY about a LIFE INSURANCE request that the lead submitted.
- Allowed topics ONLY: mortgage protection, final expense, cash value/IUL, veteran life programs.
- You MUST NEVER mention or discuss: resorts, hotels, vacations, timeshares, travel, energy plans, utilities, solar, Medicare, health insurance, ACA/Obamacare, auto insurance, home insurance, cable/internet, phone plans, warranties, debt relief, credit repair, alarms, security systems, banking, loans.

ABSOLUTE BEHAVIOR LOCK (NON-NEGOTIABLE)
- NEVER apologize.
- NEVER mention scripts/prompts/system messages.
- NEVER introduce any other reason for calling.
- If you are about to say anything outside allowed scope, DO NOT SAY IT. Continue with the booking script.

BOOKING-ONLY (NON-NEGOTIABLE)
- You are NOT the licensed agent.
- Do NOT say you are an underwriter.
- Do NOT mention rates, carriers, approvals, eligibility, or ask health/age/DOB/SSN/banking questions.
- Your ONLY goal is to follow the booking script and schedule the appointment.

TURN DISCIPLINE (NON-NEGOTIABLE)
- After you ask ANY question, STOP and WAIT.
- Do NOT fill silence.

LEAD INFO (USE ONLY WHAT IS PROVIDED)
- Name: ${ctx.clientFirstName || ""} ${ctx.clientLastName || ""}
- Notes: ${ctx.clientNotes || "(none)"}
- Script key: ${scriptKey}

MOST IMPORTANT:
- FOLLOW THE SCRIPT BELOW EXACTLY IN ORDER.
- Use REBUTTALS only when the lead objects, then return to booking.
`.trim();

  const script = getScriptBlock(ctx);

  return `${base}\n\n====================\nREAL CALL SCRIPT\n====================\n${script}`;
}

/**
 * ✅ Short per-turn instruction (keeps audio reliable)
 * We reference the system prompt’s REAL CALL SCRIPT without re-sending it every turn.
 */
function buildShortNextStepInstruction(): string {
  return `
STRICT OUTPUT RULES (NON-NEGOTIABLE):
- Speak ONLY the next step of the REAL CALL SCRIPT already provided in the system prompt.
- Read it as written. Do NOT paraphrase. Do NOT add anything new.
- Do NOT invent any scenario (no resorts, no travel, no healthcare, no utilities, no other products).
- Do NOT apologize. Do NOT mention scripts/prompts.
- After your line/question, STOP and WAIT.
- If the lead objects, use ONE rebuttal from REBUTTALS, then return to booking.
`.trim();
}

/**
 * HTTP + WebSocket server
 */
const server = http.createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");

      if (req.method === "POST" && url.pathname === "/start-session") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", async () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const { userEmail, sessionId, folderId, total } = payload;

            console.log("[AI-VOICE] /start-session received:", {
              userEmail,
              sessionId,
              folderId,
              total,
            });

            if (AI_DIALER_CRON_KEY) {
              try {
                const workerUrl = new URL(
                  "/api/ai-calls/worker",
                  COVECRM_BASE_URL
                );
                workerUrl.searchParams.set("key", AI_DIALER_CRON_KEY);

                await fetch(workerUrl.toString(), {
                  method: "POST",
                  headers: {
                    "x-cron-key": AI_DIALER_CRON_KEY,
                  },
                });
              } catch (err: any) {
                console.error(
                  "[AI-VOICE] Error kicking AI worker from /start-session:",
                  err?.message || err
                );
              }
            }

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (err: any) {
            console.error(
              "[AI-VOICE] /start-session JSON parse error:",
              err?.message || err
            );
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
          }
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/stop-session") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const { userEmail, sessionId } = payload;

            console.log("[AI-VOICE] /stop-session received:", {
              userEmail,
              sessionId,
            });

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (err: any) {
            console.error(
              "[AI-VOICE] /stop-session JSON parse error:",
              err?.message || err
            );
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
          }
        });
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
    } catch (err: any) {
      console.error("[AI-VOICE] HTTP server error:", err?.message || err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Internal server error" }));
    }
  }
);

const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  console.log("[AI-VOICE] New WebSocket connection");

  const state: CallState = {
    streamSid: "",
    callSid: "",
    pendingAudioFrames: [],
    waitingForResponse: false,
    aiSpeaking: false,
    userAudioMsBuffered: 0,
    initialGreetingQueued: false,
    openAiReady: false,
    openAiConfigured: false,
    debugLoggedMissingTrack: false,

    phase: "init",

    outboundMuLawBuffer: Buffer.alloc(0),
    outboundPacerTimer: null,
    outboundOpenAiDone: false,

    voicemailSkipArmed: false,
  };

  calls.set(ws, state);

  ws.on("message", async (data: WebSocket.RawData) => {
    try {
      const text = data.toString();
      const msg: TwilioStreamMessage = JSON.parse(text);

      switch (msg.event) {
        case "start":
          await handleStart(ws, msg as TwilioStartEvent);
          break;
        case "media":
          await handleMedia(ws, msg as TwilioMediaEvent);
          break;
        case "stop":
          await handleStop(ws, msg as TwilioStopEvent);
          break;
        default:
        // ignore other events
      }
    } catch (err: any) {
      console.error("[AI-VOICE] Error handling message:", err?.message || err);
    }
  });

  ws.on("close", () => {
    console.log("[AI-VOICE] WebSocket closed");
    const st = calls.get(ws);

    if (st) {
      stopOutboundPacer(ws, st, "twilio ws close");
    }

    if (st?.openAiWs) {
      try {
        st.openAiWs.close();
      } catch {}
    }
    calls.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("[AI-VOICE] WebSocket error:", err);
  });
});

server.listen(PORT, () => {
  console.log(`[AI-VOICE] HTTP + WebSocket server listening on port ${PORT}`);
});

/**
 * START
 */
async function handleStart(ws: WebSocket, msg: TwilioStartEvent) {
  const state = calls.get(ws);
  if (!state) return;

  state.streamSid = msg.streamSid;
  state.callSid = msg.start.callSid;
  state.callStartedAtMs = Date.now();
  state.billedUsageSent = false;

  setWaitingForResponse(state, false, "start/reset");
  setAiSpeaking(state, false, "start/reset");

  state.userAudioMsBuffered = 0;
  state.initialGreetingQueued = false;
  state.phase = "init";

  state.openAiReady = false;
  state.openAiConfigured = false;

  state.pendingAudioFrames = [];
  state.debugLoggedFirstMedia = false;
  state.debugLoggedFirstOutputAudio = false;
  state.debugLoggedMissingTrack = false;

  state.outboundMuLawBuffer = Buffer.alloc(0);
  state.outboundOpenAiDone = false;
  stopOutboundPacer(ws, state, "start/reset");

  state.voicemailSkipArmed = false;

  const custom = msg.start.customParameters || {};
  const sessionId = custom.sessionId;
  const leadId = custom.leadId;

  console.log(
    `[AI-VOICE] start: callSid=${state.callSid}, streamSid=${state.streamSid}, sessionId=${sessionId}, leadId=${leadId}`
  );

  if (!sessionId || !leadId) {
    console.warn("[AI-VOICE] Missing sessionId or leadId in customParameters");
    return;
  }

  try {
    const url = new URL("/api/ai-calls/context", COVECRM_BASE_URL);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("leadId", leadId);
    url.searchParams.set("key", AI_DIALER_CRON_KEY);
    url.searchParams.set("callSid", state.callSid);

    const resp = await fetch(url.toString());
    const json: any = await resp.json();

    if (!resp.ok || !json.ok) {
      console.error(
        "[AI-VOICE] Failed to fetch AI context:",
        json?.error || resp.statusText
      );
      return;
    }

    const context: AICallContext = json.context;
    (context as any).scriptKey = normalizeScriptKey((context as any).scriptKey);
    state.context = context;

    console.log(
      `[AI-VOICE] Loaded context for ${context.clientFirstName} (agent: ${context.agentName}, voice: ${context.voiceProfile.aiName}, openAiVoiceId: ${context.voiceProfile.openAiVoiceId}, scriptKey: ${context.scriptKey}, answeredBy: ${context.answeredBy || "(none)"})`
    );

    await initOpenAiRealtime(ws, state);
  } catch (err: any) {
    console.error("[AI-VOICE] Error fetching AI context:", err?.message || err);
  }
}

/**
 * MEDIA
 */
async function handleMedia(ws: WebSocket, msg: TwilioMediaEvent) {
  const state = calls.get(ws);
  if (!state) return;

  const { payload } = msg.media;

  const rawTrack = msg.media.track;
  const track = typeof rawTrack === "string" ? rawTrack.toLowerCase() : "";

  if (!track && !state.debugLoggedMissingTrack) {
    console.log("[AI-VOICE] handleMedia: track missing on inbound frame", {
      streamSid: state.streamSid,
      aiSpeaking: !!state.aiSpeaking,
      waitingForResponse: !!state.waitingForResponse,
    });
    state.debugLoggedMissingTrack = true;
  }

  if (track === "outbound") return;
  if (state.voicemailSkipArmed) return;

  const outboundInProgress =
    !!state.outboundPacerTimer ||
    (state.outboundMuLawBuffer?.length || 0) > 0 ||
    (!!state.outboundOpenAiDone === false && !!state.outboundPacerTimer);

  if (
    state.aiSpeaking === true ||
    state.waitingForResponse === true ||
    outboundInProgress
  ) {
    return;
  }

  state.userAudioMsBuffered = (state.userAudioMsBuffered || 0) + 20;

  if (!state.debugLoggedFirstMedia) {
    console.log("[AI-VOICE] handleMedia: first audio frame received", {
      streamSid: state.streamSid,
      hasOpenAi: !!state.openAiWs,
      openAiReady: !!state.openAiReady,
      payloadLength: payload?.length || 0,
      track: rawTrack || "(undefined)",
      aiSpeaking: !!state.aiSpeaking,
      waitingForResponse: !!state.waitingForResponse,
      phase: state.phase,
    });
    state.debugLoggedFirstMedia = true;
  }

  if (!state.openAiWs || !state.openAiReady) {
    state.pendingAudioFrames.push(payload);
    return;
  }

  try {
    state.openAiWs.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: payload,
      })
    );
  } catch (err: any) {
    console.error(
      "[AI-VOICE] Error forwarding audio to OpenAI:",
      err?.message || err
    );
  }
}

/**
 * STOP
 */
async function handleStop(ws: WebSocket, msg: TwilioStopEvent) {
  const state = calls.get(ws);
  if (!state) return;

  console.log(
    `[AI-VOICE] stop: callSid=${msg.stop.callSid}, streamSid=${msg.streamSid}`
  );

  state.phase = "ended";
  stopOutboundPacer(ws, state, "twilio stop");

  if (state.openAiWs) {
    try {
      state.openAiWs.close();
    } catch {}
  }

  try {
    await billAiDialerUsageForCall(state);
  } catch (err: any) {
    console.error(
      "[AI-VOICE] Error billing AI Dialer usage:",
      err?.message || err
    );
  }

  calls.delete(ws);
}

/**
 * OpenAI Realtime init
 */
async function initOpenAiRealtime(ws: WebSocket, state: CallState) {
  if (!OPENAI_API_KEY) {
    console.error(
      "[AI-VOICE] OPENAI_API_KEY not set; cannot start realtime session."
    );
    return;
  }
  if (!state.context) {
    console.error("[AI-VOICE] No context available for OpenAI session.");
    return;
  }

  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(
    OPENAI_REALTIME_MODEL
  )}`;

  console.log("[AI-VOICE] Connecting to OpenAI Realtime:", url);

  const openAiWs = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  state.openAiWs = openAiWs;

  openAiWs.on("open", () => {
    console.log("[AI-VOICE] OpenAI Realtime connected");

    state.openAiReady = false;
    state.openAiConfigured = false;

    const systemPrompt = buildSystemPrompt(state.context!);

    try {
      const k = normalizeScriptKey(state.context?.scriptKey);
      const n = (state.context?.clientFirstName || "").trim() || "there";
      const s = getSelectedScriptText(state.context!);
      const preview = String(s || "").replace(/\s+/g, " ").slice(0, 180);
      console.log("[AI-VOICE][SCRIPT-SELECT]", {
        scriptKey: k,
        clientFirstName: n,
        scriptPreview: preview,
      });
    } catch {}

    const sessionUpdate = {
      type: "session.update",
      session: {
        instructions: systemPrompt,
        modalities: ["audio", "text"],
        voice: state.context!.voiceProfile.openAiVoiceId || "alloy",

        // ✅ Low temp reduces drift / hallucination
        temperature: 0.2,

        input_audio_format: "g711_ulaw",
        output_audio_format: "pcm16",

        turn_detection: {
          type: "server_vad",
          create_response: false,
        },
      },
    };

    try {
      console.log("[AI-VOICE] Sending session.update with voice:", {
        openAiVoiceId: state.context!.voiceProfile.openAiVoiceId,
        model: OPENAI_REALTIME_MODEL,
      });
      openAiWs.send(JSON.stringify(sessionUpdate));
    } catch (err: any) {
      console.error(
        "[AI-VOICE] Error sending session.update:",
        err?.message || err
      );
    }
  });

  openAiWs.on("message", async (data: WebSocket.RawData) => {
    try {
      const text = data.toString();
      const event = JSON.parse(text);

      if (event?.type === "error") {
        console.error("[AI-VOICE] OpenAI ERROR event:", event);
      } else if (event?.type) {
        console.log("[AI-VOICE] OpenAI event:", event.type);
      }

      await handleOpenAiEvent(ws, state, event);
    } catch (err: any) {
      console.error(
        "[AI-VOICE] Error handling OpenAI event:",
        err?.message || err
      );
    }
  });

  openAiWs.on("close", () => {
    console.log("[AI-VOICE] OpenAI Realtime closed");
  });

  openAiWs.on("error", (err) => {
    console.error("[AI-VOICE] OpenAI Realtime error:", err);
  });
}

/**
 * OpenAI events → Twilio + control metadata
 */
async function handleOpenAiEvent(
  twilioWs: WebSocket,
  state: CallState,
  event: any
) {
  const { streamSid, context } = state;
  if (!context) return;

  const t = String(event?.type || "");

  if (t === "session.updated" && !state.openAiConfigured) {
    state.openAiConfigured = true;
    state.openAiReady = true;

    state.phase = "awaiting_greeting_reply";

    if (state.pendingAudioFrames.length > 0) {
      console.log(
        "[AI-VOICE] Dropping buffered inbound frames before greeting:",
        state.pendingAudioFrames.length
      );
      state.pendingAudioFrames = [];
    }

    try {
      state.openAiWs?.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
    } catch {}

    if (
      !state.waitingForResponse &&
      !state.initialGreetingQueued &&
      state.openAiWs
    ) {
      state.initialGreetingQueued = true;

      (async () => {
        try {
          const existing = String(state.context?.answeredBy || "").trim();
          if (!existing) {
            await refreshAnsweredByFromCoveCRM(state, "pre-greeting #1");
            await sleep(450);
            await refreshAnsweredByFromCoveCRM(state, "pre-greeting #2");
          }
        } catch {}

        const answeredByNow = String(
          state.context?.answeredBy || ""
        ).toLowerCase();
        if (isVoicemailAnsweredBy(answeredByNow)) {
          console.log("[AI-VOICE] Voicemail/machine — suppressing all speech", {
            streamSid: state.streamSid,
            callSid: state.callSid,
            answeredBy: answeredByNow || "(machine)",
          });
          state.voicemailSkipArmed = true;
          safelyCloseOpenAi(state, "voicemail detected pre-greeting");
          return;
        }

        const isHuman = answeredByNow === "human";
        try {
          if (isHuman) await sleep(1200);
        } catch {}

        const liveState = calls.get(twilioWs);
        if (
          !liveState ||
          !liveState.openAiWs ||
          liveState.waitingForResponse ||
          !liveState.openAiReady
        ) {
          return;
        }

        liveState.userAudioMsBuffered = 0;

        setWaitingForResponse(liveState, true, "response.create (greeting)");
        setAiSpeaking(liveState, true, "response.create (greeting)");
        liveState.outboundOpenAiDone = false;

        liveState.openAiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: buildGreetingInstructions(liveState.context!),
            },
          })
        );
      })();
    }

    return;
  }

  if (t === "input_audio_buffer.committed") {
    if (state.voicemailSkipArmed) return;
    if (!state.openAiWs || !state.openAiReady) return;
    if (state.waitingForResponse || state.aiSpeaking) return;

    state.userAudioMsBuffered = 0;

    setWaitingForResponse(state, true, "response.create (user turn)");
    setAiSpeaking(state, true, "response.create (user turn)");
    state.outboundOpenAiDone = false;

    state.openAiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions: buildShortNextStepInstruction(),
        },
      })
    );

    state.phase = "in_call";
    return;
  }

  if (t === "response.audio.delta" || t === "response.output_audio.delta") {
    if (state.voicemailSkipArmed) return;

    setAiSpeaking(state, true, `OpenAI ${t} (audio delta)`);

    let payloadBase64: string | undefined;

    if (typeof event.delta === "string") payloadBase64 = event.delta;
    else if (event.delta && typeof event.delta.audio === "string") {
      payloadBase64 = event.delta.audio as string;
    }

    if (payloadBase64) {
      const mulawBase64 = pcm16ToMulawBase64(payloadBase64);
      const mulawBytes = Buffer.from(mulawBase64, "base64");

      if (!state.debugLoggedFirstOutputAudio) {
        console.log("[AI-VOICE] First OpenAI audio delta received", {
          streamSid,
          pcmLength: payloadBase64.length,
          mulawBase64Len: mulawBase64.length,
          mulawBytesLen: mulawBytes.length,
        });
        state.debugLoggedFirstOutputAudio = true;
      }

      state.outboundMuLawBuffer = Buffer.concat([
        state.outboundMuLawBuffer || Buffer.alloc(0),
        mulawBytes,
      ]);

      ensureOutboundPacer(twilioWs, state);
    }
  }

  const isResponseDone =
    t === "response.completed" ||
    t === "response.done" ||
    t === "response.output_audio.done" ||
    t === "response.audio.done" ||
    t === "response.cancelled" ||
    t === "response.interrupted";

  const isAudioItemDone =
    t === "response.output_item.done" &&
    (event?.item?.type === "output_audio" ||
      event?.output_item?.type === "output_audio" ||
      event?.item?.content_type === "audio" ||
      event?.output_item?.content_type === "audio");

  if (isResponseDone || isAudioItemDone) {
    setWaitingForResponse(state, false, `OpenAI ${t}`);
    state.outboundOpenAiDone = true;

    const buffered = state.outboundMuLawBuffer?.length || 0;
    if (buffered < TWILIO_FRAME_BYTES) {
      state.outboundMuLawBuffer = Buffer.alloc(0);
      stopOutboundPacer(twilioWs, state, "OpenAI done + <1 frame buffered");
      setAiSpeaking(state, false, `OpenAI ${t} (buffer < 1 frame)`);
    }
  }

  try {
    const control =
      event?.control ||
      event?.metadata?.control ||
      event?.item?.metadata?.control;

    if (control && typeof control === "object") {
      if (control.kind === "book_appointment" && !state.finalOutcomeSent) {
        await handleBookAppointmentIntent(state, control);
      }

      if (
        control.kind === "final_outcome" &&
        control.outcome &&
        !state.finalOutcomeSent
      ) {
        await handleFinalOutcomeIntent(state, control);
        state.finalOutcomeSent = true;
      }
    }
  } catch (err: any) {
    console.error(
      "[AI-VOICE] Error parsing control intent:",
      err?.message || err
    );
  }
}

/**
 * book_appointment intent
 */
async function handleBookAppointmentIntent(state: CallState, control: any) {
  const ctx = state.context;
  if (!ctx) return;

  if (!AI_DIALER_CRON_KEY) {
    console.error(
      "[AI-VOICE] AI_DIALER_CRON_KEY not set; cannot call book-appointment endpoint."
    );
    return;
  }

  const {
    startTimeUtc,
    durationMinutes,
    leadTimeZone,
    agentTimeZone,
    notes,
  } = control;

  if (!startTimeUtc || !durationMinutes || !leadTimeZone || !agentTimeZone) {
    console.warn(
      "[AI-VOICE] Incomplete book_appointment control payload:",
      control
    );
    return;
  }

  try {
    const url = new URL(BOOK_APPOINTMENT_URL);
    url.searchParams.set("key", AI_DIALER_CRON_KEY);

    const body = {
      aiCallSessionId: ctx.sessionId,
      leadId: ctx.leadId,
      startTimeUtc,
      durationMinutes,
      leadTimeZone,
      agentTimeZone,
      notes,
      source: "ai-dialer",
    };

    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ai-dialer-key": AI_DIALER_CRON_KEY,
      },
      body: JSON.stringify(body),
    });

    const json: any = await resp.json();
    if (!resp.ok || !json.ok) {
      console.error(
        "[AI-VOICE] book-appointment failed:",
        json?.error || resp.statusText
      );
      return;
    }

    console.log(
      `[AI-VOICE] Appointment booked for lead ${ctx.clientFirstName} ${ctx.clientLastName} – eventId=${json.eventId}`
    );
  } catch (err: any) {
    console.error(
      "[AI-VOICE] Error calling book-appointment endpoint:",
      err?.message || err
    );
  }
}

/**
 * final_outcome intent
 */
async function handleFinalOutcomeIntent(state: CallState, control: any) {
  const ctx = state.context;
  if (!ctx) return;

  if (!AI_DIALER_AGENT_KEY) {
    console.error(
      "[AI-VOICE] AI_DIALER_AGENT_KEY not set; cannot call outcome endpoint."
    );
    return;
  }

  const allowedOutcomes = [
    "unknown",
    "booked",
    "not_interested",
    "no_answer",
    "callback",
    "do_not_call",
    "disconnected",
  ] as const;

  const outcomeRaw: string | undefined = control.outcome;
  const summary: string | undefined = control.summary;
  const notesAppend: string | undefined = control.notesAppend;

  if (!outcomeRaw || !allowedOutcomes.includes(outcomeRaw as any)) {
    console.warn(
      "[AI-VOICE] Invalid or missing final outcome in control payload:",
      control
    );
    return;
  }

  try {
    const body: any = {
      callSid: state.callSid,
      outcome: outcomeRaw,
      summary,
      notesAppend,
    };

    const resp = await fetch(OUTCOME_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-key": AI_DIALER_AGENT_KEY,
      },
      body: JSON.stringify(body),
    });

    const json: any = await resp.json();
    if (!resp.ok || !json.ok) {
      console.error(
        "[AI-VOICE] outcome endpoint failed:",
        json?.message || resp.statusText
      );
      return;
    }

    console.log(
      `[AI-VOICE] Outcome recorded for call ${state.callSid}:`,
      json.outcome,
      "moved=",
      json.moved
    );
  } catch (err: any) {
    console.error(
      "[AI-VOICE] Error calling outcome endpoint:",
      err?.message || err
    );
  }
}

/**
 * Vendor usage analytics
 */
async function billAiDialerUsageForCall(state: CallState) {
  if (state.billedUsageSent) return;
  if (!state.context) return;
  if (!AI_DIALER_AGENT_KEY) {
    console.error(
      "[AI-VOICE] AI_DIALER_AGENT_KEY not set; cannot call usage endpoint."
    );
    return;
  }

  const startedAtMs = state.callStartedAtMs ?? Date.now();
  const endedAtMs = Date.now();
  const diffMs = Math.max(0, endedAtMs - startedAtMs);

  const rawMinutes = diffMs / 60000;
  const minutes = rawMinutes <= 0 ? 0.01 : Math.round(rawMinutes * 100) / 100;

  const vendorCostUsd = minutes * AI_DIALER_VENDOR_COST_PER_MIN_USD;

  const body = {
    userEmail: state.context.userEmail,
    minutes,
    vendorCostUsd,
    callSid: state.callSid,
    sessionId: state.context.sessionId,
  };

  try {
    const resp = await fetch(USAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-key": AI_DIALER_AGENT_KEY,
      },
      body: JSON.stringify(body),
    });

    const json: any = await resp.json();
    if (!resp.ok || !json.ok) {
      console.error(
        "[AI-VOICE] usage endpoint failed:",
        json?.error || resp.statusText
      );
      return;
    }

    console.log("[AI-VOICE] AI Dialer usage tracked (vendor analytics):", {
      email: state.context.userEmail,
      minutes,
      vendorCostUsd,
      callSid: state.callSid,
      sessionId: state.context.sessionId,
    });

    state.billedUsageSent = true;
  } catch (err: any) {
    console.error(
      "[AI-VOICE] Error calling usage endpoint:",
      err?.message || err
    );
  }
}
