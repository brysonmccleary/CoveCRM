// ---- env bootstrap (ai-voice-server) ----
// Loads env vars for local/dev & non-vercel runtimes.
// NOTE: Vercel env vars do NOT exist in your local shell unless you export them.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

function loadEnvForAiVoiceServer() {
  // index.ts is in ai-voice-server/, so repo root is one level up
  const here = __dirname;
  const candidates = [
    path.resolve(here, ".env"),
    path.resolve(here, "../.env.local"),
    path.resolve(here, "../.env.live"),
    path.resolve(here, "../.env"),
    path.resolve(here, "../../.env.local"),
    path.resolve(here, "../../.env.live"),
    path.resolve(here, "../../.env"),
  ];

  for (const fp of candidates) {
    try {
      if (fs.existsSync(fp)) {
        dotenv.config({ path: fp });
      }
    } catch {}
  }
}

loadEnvForAiVoiceServer();
// ---- end env bootstrap ----

// ai-voice-server/index.ts
import http, { IncomingMessage, ServerResponse } from "http";
import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch";
import { Buffer } from "buffer";
import { getKaylaSignupScript } from "./scripts/kaylaSignupScript";
import {
  buildInboundGreetingInstructions,
  buildInboundReasonLine,
  buildInboundReasonInstructions,
  shouldUseInboundFlow,
} from "./flows/inbound";

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
const COVECRM_API_SECRET = process.env.COVECRM_API_SECRET || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

// Your internal vendor-cost estimate (Twilio + OpenAI)
const AI_DIALER_VENDOR_COST_PER_MIN_USD = Number(
  process.env.AI_DIALER_VENDOR_COST_PER_MIN_USD || "0"
);

// OpenAI Realtime
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
const OPENAI_REALTIME_AUDIO_FORMAT = "g711_ulaw";

console.log("[AI-VOICE] Realtime model resolved:", OPENAI_REALTIME_MODEL, "(env:", process.env.OPENAI_REALTIME_MODEL ? "set" : "default", ")");
console.log("[AI-VOICE] Realtime GA session mode enabled");

const REQUIRED_VARS = [
  "OPENAI_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "AI_DIALER_CRON_KEY",
  "AI_DIALER_AGENT_KEY",
  "COVECRM_BASE_URL",
];
for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    console.error(`[AI-VOICE] ⚠️ Missing env var: ${v} — some features may not work`);
  }
}
console.log("[AI-VOICE] Model:", OPENAI_REALTIME_MODEL);
console.log("[AI-VOICE] CoveCRM base:", COVECRM_BASE_URL);

function buildRealtimeResponseCreate(
  instructions: string,
  options: { temperature?: number } = {}
) {
  const response: any = {
    output_modalities: ["audio"],
    instructions,
    audio: {
      output: {
        format: { type: "audio/pcmu" },
      },
    },
  };

  return {
    type: "response.create",
    response,
  };
}

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
const TRANSFER_TWIML_URL = new URL("/api/ai-calls/transfer-twiml", COVECRM_BASE_URL).toString();

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
  callDirection?: string;
  scriptKey: string;
  voiceKey: string;
  voiceProfile: {
    aiName: string;
    openAiVoiceId: string;
    style: string;
  };

  // ✅ Optional AMD hint from CoveCRM (AnswerBy=human/machine/unknown etc)
  answeredBy?: string;

  // ✅ Live transfer settings (from AISettings via context API)
  liveTransferEnabled?: boolean;
  liveTransferPhone?: string;

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

  // ✅ Delay advancing out of greeting until we confirm OpenAI actually produced audio (prevents Step 0 skip)
  greetingAdvancePending?: boolean;
  greetingAdvanceNextIndex?: number;
  greetingAdvanceNextPhase?: CallPhase;
  pendingLiveTransferAvailabilityConfirm?: boolean;
  pendingLiveTransferAvailabilityAttempts?: number;
  pendingLiveTransferAfterLine?: boolean;
  transferStarting?: boolean;
  transferInProgress?: boolean;
  liveTransferIntroSpoken?: boolean;

  // ✅ strict call phase to enforce “greet → WAIT → script”
  phase?: CallPhase;

  // diagnostics
  debugLoggedMissingTrack?: boolean;

  // ✅ Outbound pacing buffer (μ-law bytes)
  outboundMuLawBuffer?: Buffer;
  outboundPacerTimer?: NodeJS.Timeout | null;
  outboundOpenAiDone?: boolean;
  // ✅ User-turn watchdog (prevents "stuck VAD" -> dead silence)
  userSpeechInProgress?: boolean;
  userSpeechCommitWatchdog?: NodeJS.Timeout | null;
  // ✅ If OpenAI never emits speech_stopped (comfort-noise / VAD edge), force a commit so we don't go silent forever.
  userSpeechStuckWatchdog?: NodeJS.Timeout | null;
  // ✅ If user commits while outbound pacer is still draining (aiSpeaking true), we must NOT drop the turn.
  // We queue it here and replay immediately when pacer drains and aiSpeaking flips to false.
  pendingCommittedTurn?: { bestTranscript: string; audioMs: number; atMs: number } | null;

  // ✅ voicemail skip safety
  voicemailSkipArmed?: boolean;

  /**
   * ============================
   * ✅ SCRIPT ADHERENCE (NEW)
   * ============================
   * We do NOT change any audio logic.
   * We only control WHAT text the model is allowed to speak by sending the exact next script line.
   */
  scriptSteps?: string[];
  scriptStepIndex?: number;

  // last user text (only if OpenAI emits it; non-blocking)
  lastUserTranscript?: string;

  // ✅ Realtime transcription aggregation (OpenAI events may stream deltas per item_id)
  lastUserTranscriptByItemId?: Record<string, string>;
  lastUserTranscriptPartialByItemId?: Record<string, string>;
  lastTranscriptDeltaAtMs?: number;
  lastTranscriptCompletedAtMs?: number;
  deferredTurnTranscript?: string;
  deferredTurnAtMs?: number;
  deferredTurnSource?: "main" | "replay";
  deferredTurnReason?: string;

  // ✅ Human-like waiting + reprompt (NEW)
  lastPromptSentAtMs?: number;
  lastPromptLine?: string;
  repromptCountForCurrentStep?: number;
  lowSignalCommitCount?: number;

  // ✅ time indecision handling (availability / 'you pick')
  timeOfferCountForStepIndex?: number;
  timeOfferCount?: number;

  // Passive durable conversation memory (diagnostics only; no routing decisions read these yet)
  selectedDay?: "today" | "tomorrow" | string;
  selectedTimeText?: string;
  selectedWindow?: TimeWindowHint;
  lastAnsweredIntent?: string;
  resolvedObjectionKinds?: string[];
  lastOfferedSlots?: string[];
  lastRouteKind?: string;
  lastRouteReason?: string;
  routeSequenceId?: number;
  currentTurnId?: string;
  responseCreateId?: string;
  lastDuplicateGuardKey?: string;
  lastDuplicateGuardAtMs?: number;
  step2BookingFrameAskedAtMs?: number;
  step2BookingFrameAskedCount?: number;
  lastBookingFrameNorm?: string;

  // instrumentation: system prompt markers
  systemPromptLen?: number;
  systemPromptHead300?: string;
  systemPromptTail700?: string;
  systemPromptMarkers?: Record<string, boolean>;
  systemPromptUniqueLine?: string;

  // instrumentation: one-time response.create logs
  debugLoggedResponseCreateGreeting?: boolean;
  debugLoggedResponseCreateUserTurn?: boolean;

  /**
   * ============================
   * ✅ TURN-TAKING FIXES (SURGICAL)
   * ============================
   */
  // Hard guard: ensure we never send multiple response.create per committed user turn
  responseInFlight?: boolean;

  // Barge-in detection (Twilio side) so we can cancel OpenAI immediately
  bargeInDetected?: boolean;
  bargeInAudioMsBuffered?: number;
  bargeInFrames?: string[]; // tiny ring buffer of inbound frames during barge-in
  lastCancelAtMs?: number;
  aiAudioStartedAtMs?: number; // first outbound audio delta timestamp (per response)

  // micro anti-spam: last response.create timestamp (prevents rapid double-fires)
  lastResponseCreateAtMs?: number;
  lastHandledTurnKey?: string;
  // cost control: throttle silence frames we forward to OpenAI (keep VAD working)
  lastSilenceSentAtMs?: number;
  inputCommitInFlight?: boolean;
  lastInputCommitAtMs?: number;


  /**
   * ============================
   * ✅ TURN-TAKING STATE (NEW)
   * ============================
   */
  lastUserSpeechStartedAtMs?: number;
  lastUserSpeechStoppedAtMs?: number;
  lastAiDoneAtMs?: number;
  awaitingUserAnswer?: boolean;
  awaitingAnswerForStepIndex?: number;
  // ✅ Patch 3: remember the last *accepted* user text so we can validate booking + step advance
  lastAcceptedUserText?: string;
  lastAcceptedStepType?: StepType;
  lastAcceptedStepIndex?: number;

  // ── Conversation memory (ChatGPT-voice parity) ──
  // Ring buffer of last 3 exchanges: {role, text, stepIndex?}
  recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
  // Repeat-objection tracking
  lastObjectionKind?: string;
  objectionRepeatCount?: number;

  // silence watchdog: arms after greeting or each AI turn; cancelled on speech_started
  silenceWatchdog?: NodeJS.Timeout | null;
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

  if (v === "veteran_iul" || v === "iul_veteran" || v === "veterans_iul") return "veteran_iul";
  if (v === "veteran_mortgage" || v === "mortgage_veteran" || v === "veterans_mortgage") return "veteran_mortgage";
  if (v === "trucker_iul" || v === "iul_trucker" || v === "truckers_iul") return "trucker_iul";
  if (v === "trucker_mortgage" || v === "mortgage_trucker" || v === "truckers_mortgage") return "trucker_mortgage";

  if (v === "kayla_signup" || v === "kayla" || v === "kayla_demo") {
    return "kayla_signup";
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
    v === "veteran_iul" ||
    v === "veteran_mortgage" ||
    v === "trucker_iul" ||
    v === "trucker_mortgage" ||
    v === "generic_life" ||
    v === "kayla_signup"
  ) {
    return v;
  }

  return "mortgage_protection";
}
/**
 * ✅ Script-aware scope label (prevents cross-script wording drift)
 * We keep the hard lock, but we match the selected scriptKey.
 */
function getScopeLabelForScriptKey(scriptKeyRaw: any): string {
  const k = normalizeScriptKey(scriptKeyRaw);
  if (k === "kayla_signup") return "CoveCRM demo";
  if (k === "mortgage_protection") return "mortgage protection";
  if (k === "final_expense") return "final expense coverage";
  if (k === "iul_cash_value") return "cash value life insurance (IUL)";
  if (k === "veteran_leads") return "veteran life insurance programs";
  if (k === "trucker_leads") return "life insurance for truckers";
  if (k === "veteran_iul") return "veteran IUL program";
  if (k === "veteran_mortgage") return "mortgage protection for veterans";
  if (k === "trucker_iul") return "IUL program for truckers";
  if (k === "trucker_mortgage") return "mortgage protection for truckers";
  if (k === "generic_life") return "life insurance";
  return "life insurance";
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
    const o0 = i * 2;
    if (o0 + 1 >= pcmBuf.length) break;

    // Tiny anti-aliasing low-pass for 24k -> 8k:
    // Use a 3-tap triangular filter: (s0 + 2*s1 + s2) / 4, then decimate by 3.
    const s0 = pcmBuf.readInt16LE(o0);

    let s1 = s0;
    const o1 = o0 + 2;
    if (o1 + 1 < pcmBuf.length) s1 = pcmBuf.readInt16LE(o1);

    let s2 = s1;
    const o2 = o0 + 4;
    if (o2 + 1 < pcmBuf.length) s2 = pcmBuf.readInt16LE(o2);

    const filtered = (s0 + (2 * s1) + s2) / 4;
    const mu = linearToMulaw(filtered | 0);
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

function randInt(min: number, max: number): number {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return Math.floor(a + Math.random() * (b - a + 1));
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

  // Per-response reset: a new response.create is starting. Audio has NOT begun yet.
  // This is used only for barge-in cancel gating (prevents instant cancels before first audio delta).
  if (next === true && reason.includes("response.create")) {
    state.aiAudioStartedAtMs = 0;
    state.bargeInDetected = false;
    state.bargeInAudioMsBuffered = 0;
    state.bargeInFrames = [];

    // ✅ Per-response reset: ensure we don't treat a prior response as already "done"
    // (prevents pacer from stopping late / cancel from firing against an already-finished response)
    state.outboundOpenAiDone = false;
  }

  console.log("[AI-VOICE] waitingForResponse =", next, "|", reason);
}

function setResponseInFlight(state: CallState, next: boolean, reason: string) {
  const prev = !!state.responseInFlight;
  if (prev === next) return;
  state.responseInFlight = next;
  console.log("[AI-VOICE] responseInFlight =", next, "|", reason);
}

/**
 * ✅ OpenAI cancel helper (REAL barge-in)
 * - Do NOT touch audio pipeline
 * - Just cancels model output so user can take the floor
 */
function tryCancelOpenAiResponse(state: CallState, reason: string) {
  try {
    const ws = state.openAiWs;
    if (!ws || !state.openAiReady) return;

    // Only cancel if the AI is actually speaking (not just waiting/outbound pacing).
    if (state.aiSpeaking !== true) return;

    // ✅ Prevent tail-chops: only cancel when a response is actively in-flight (not draining / not already done).
    if (state.responseInFlight !== true) return;
    if (state.outboundOpenAiDone === true) return;

    const now = Date.now();

    // Cooldown + pre-audio guard: never cancel before AI audio has actually started.
    const startedAt = Number(state.aiAudioStartedAtMs || 0);
    if (startedAt <= 0) return;
    if (now - startedAt < 650) return;

    // ✅ If OpenAI already signaled DONE for this response, do NOT cancel.
    // This prevents "response_cancel_not_active" when local flags lag behind OpenAI timing.
    const doneAt = Number(state.lastAiDoneAtMs || 0);
    if (doneAt > 0 && doneAt >= startedAt) return;


    const last = Number(state.lastCancelAtMs || 0);

    // throttle to avoid spam if Twilio frames keep arriving
    if (now - last < 500) return;

    state.lastCancelAtMs = now;

    // Cancel the current response
        // IMPORTANT: once we cancel, immediately drop turn blockers so inbound audio can flow.
    // OpenAI may still stream late deltas; we guard against that elsewhere.
    state.lastCancelAtMs = Date.now();
    state.waitingForResponse = false;
    state.responseInFlight = false;
    state.aiSpeaking = false;
    // ✅ HARD-STOP (local): even if OpenAI cancel races ("response_cancel_not_active"),
    // stop audio playback immediately so caller can finish speaking.
    try {
      if (state.outboundPacerTimer) {
        clearInterval(state.outboundPacerTimer as any);
        state.outboundPacerTimer = null as any;
        console.log("[AI-VOICE][PACE] stopped | barge-in hard-stop");
      }
    } catch {}
    try {
      // Clear any queued outbound audio so nothing else plays after barge-in
      (state as any).outboundMuLawBuffer = Buffer.alloc(0);
      (state as any).outboundPadZerosRemaining = 0;
      (state as any).outboundPacerPadZerosRemaining = 0;
    } catch {}

    ws.send(JSON.stringify({ type: "response.cancel" }));

    // Clear any partially buffered input in OpenAI so next turn starts clean
    try {
      ws.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
    } catch {}

    // Yield the turn locally
    setWaitingForResponse(state, false, `barge-in cancel (${reason})`);
    setAiSpeaking(state, false, `barge-in cancel (${reason})`);
    setResponseInFlight(state, false, `barge-in cancel (${reason})`);

    // Mark outbound as "done" so pacer will stop once buffer drains naturally
    state.outboundOpenAiDone = true;

    console.log("[AI-VOICE][BARGE-IN] sent response.cancel", {
      callSid: state.callSid,
      streamSid: state.streamSid,
      reason,
    });
  } catch (err: any) {
    console.warn("[AI-VOICE][BARGE-IN] cancel failed (non-blocking):", {
      callSid: state.callSid,
      error: err?.message || err,
      reason,
    });
  }
}

function sendManualInputCommit(state: CallState, reason: string): boolean {
  try {
    if (
      state.phase === "ended" ||
      !state.openAiWs ||
      !state.openAiReady ||
      state.openAiWs.readyState !== WebSocket.OPEN
    ) {
      console.log("[AI-VOICE][VAD] stuck-speech commit skipped during active response", {
        callSid: state.callSid,
        reason,
        phase: state.phase,
        openAiReady: !!state.openAiReady,
        socketOpen: state.openAiWs?.readyState === WebSocket.OPEN,
      });
      return false;
    }

    if (state.waitingForResponse || state.responseInFlight || state.aiSpeaking) {
      console.log("[AI-VOICE][VAD] stuck-speech commit skipped during active response", {
        callSid: state.callSid,
        reason,
        waitingForResponse: !!state.waitingForResponse,
        responseInFlight: !!state.responseInFlight,
        aiSpeaking: !!state.aiSpeaking,
      });
      return false;
    }

    const now = Date.now();
    const lastCommitAt = Number(state.lastInputCommitAtMs || 0);
    if (state.inputCommitInFlight || (lastCommitAt > 0 && now - lastCommitAt < 800)) {
      console.log("[AI-VOICE][VAD] skipped duplicate input_audio_buffer.commit", {
        callSid: state.callSid,
        reason,
        inputCommitInFlight: !!state.inputCommitInFlight,
        msSinceLastCommit: lastCommitAt > 0 ? now - lastCommitAt : null,
      });
      return false;
    }

    state.inputCommitInFlight = true;
    state.lastInputCommitAtMs = now;
    state.openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    return true;
  } catch (err: any) {
    console.warn("[AI-VOICE][VAD] manual input_audio_buffer.commit failed:", {
      callSid: state.callSid,
      reason,
      error: err?.message || err,
    });
    return false;
  }
}

/**
 * ✅ Outbound pacing (Twilio wants ~20ms μ-law frames)
 * μ-law @ 8k: 20ms = 160 bytes.
 */
const TWILIO_FRAME_BYTES = 160;
const TWILIO_FRAME_MS = 20;

// Silence watchdogs (cost control)
// - after greeting / after any AI turn, we expect real human speech soon
// - if not, end the AI session so we do not burn cost on dead air
const POST_GREETING_SILENCE_MS = 15000;
const MID_CALL_SILENCE_MS = 25000;

function ensureOutboundPacer(twilioWs: WebSocket, state: CallState) {
  if (state.outboundPacerTimer) return;

  state.outboundPacerTimer = setInterval(() => {
    try {
      const live = calls.get(twilioWs);
      if (!live) return;
      if (twilioWs.readyState !== WebSocket.OPEN) {
        stopOutboundPacer(twilioWs, live, "Twilio socket closed");
        console.log("[AI-VOICE][PACE] stopped because Twilio socket closed", {
          callSid: live.callSid,
          readyState: twilioWs.readyState,
        });
        return;
      }

      const buf = live.outboundMuLawBuffer || Buffer.alloc(0);

      // ✅ Fallback: OpenAI may signal done before our outboundOpenAiDone flag flips.
      // If OpenAI already signaled DONE for the current response, treat outbound as done
      // so the pacer can flush/pad and stop immediately (prevents multi-second silence drain).
      if (!live.outboundOpenAiDone) {
        try {
          const doneAt = Number(live.lastAiDoneAtMs || 0);
          const startedAt = Number(live.aiAudioStartedAtMs || 0);
          if (doneAt > 0 && (startedAt <= 0 || doneAt >= startedAt)) {
            live.outboundOpenAiDone = true;
          }
        } catch {}
      }

      // ✅ Always send a full 20ms μ-law frame every tick while pacer is running.
      // Missing frames (underruns) can sound like clicks/static and can delay the first words.
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
        return;
      }

      // If OpenAI is done, flush any remaining tail (pad to full frame) and stop immediately.
      if (live.outboundOpenAiDone) {
        const remaining = buf.length;

        // ✅ If OpenAI is done and there is nothing left to flush, stop immediately.
        // This prevents multi-second silence drain that feels like "slow responses".
        if (remaining <= 0) {
          stopOutboundPacer(twilioWs, live, "OpenAI done + buffer empty");
          setAiSpeaking(live, false, "pacer drained");
          (live as any).lastListenEnabledAtMs = Date.now();
          (live as any).listenWarmupUntilMs = Date.now() + 2000;
          if (
            live.phase === "awaiting_greeting_reply" &&
            !live.voicemailSkipArmed &&
            calls.get(twilioWs) === live &&
            twilioWs.readyState === WebSocket.OPEN
          ) {
            (live as any).greetingAudioDone = true;
            finalizeGreetingAdvance(live, "pacer drained greeting empty");
            live.awaitingUserAnswer = true;
            live.awaitingAnswerForStepIndex = 0;
            console.log("[AI-VOICE][FIX] greeting listen re-armed", { callSid: live.callSid, reason: "pacer drained greeting empty" });
            console.log("[AI-VOICE] greetingAudioDone=true on empty-buffer drain | awaitingUserAnswer armed", { callSid: live.callSid });
            armSilenceWatchdog(twilioWs, live, POST_GREETING_SILENCE_MS, "pacer drained greeting empty");
          } else if (live.phase === "in_call") {
            (live as any).listenWarmupUntilMs = Date.now() + 2000;
            armSilenceWatchdog(twilioWs, live, MID_CALL_SILENCE_MS, "pacer drained in_call empty");
          }
          maybePerformPendingLiveTransfer(twilioWs, live, "pacer drained empty");
          if (!live.transferStarting && !live.transferInProgress) {
            void replayPendingCommittedTurn(twilioWs, live, "pacer drained");
          }
          return;
        }


        if (remaining > 0) {
          // ✅ Pad tail to a full frame so we don't clip/click at the end.
          const frame = Buffer.alloc(TWILIO_FRAME_BYTES, 0xFF);
          buf.copy(frame, 0, 0, Math.min(remaining, TWILIO_FRAME_BYTES));
          live.outboundMuLawBuffer = Buffer.alloc(0);

          twilioWs.send(
            JSON.stringify({
              event: "media",
              streamSid: live.streamSid,
              media: { payload: frame.toString("base64") },
            })
          );
        }

        stopOutboundPacer(twilioWs, live, "buffer drained after OpenAI done");
        setAiSpeaking(live, false, "pacer drained");
        (live as any).lastListenEnabledAtMs = Date.now();
        (live as any).listenWarmupUntilMs = Date.now() + 2000;
        if (live.phase === "in_call") {
          // ✅ Re-arm warmup window after every AI turn so VAD gets clean audio
          (live as any).listenWarmupUntilMs = Date.now() + 2000;
          armSilenceWatchdog(twilioWs, live, MID_CALL_SILENCE_MS, "pacer drained in_call");
        } else if (live.phase === "awaiting_greeting_reply") {
          // ✅ Unconditionally arm listening when greeting audio finishes playing
          if (
            !live.voicemailSkipArmed &&
            calls.get(twilioWs) === live &&
            twilioWs.readyState === WebSocket.OPEN
          ) {
            (live as any).greetingAudioDone = true;
            finalizeGreetingAdvance(live, "pacer drained greeting");
            live.awaitingUserAnswer = true;
            live.awaitingAnswerForStepIndex = 0;
            console.log("[AI-VOICE][FIX] greeting listen re-armed", { callSid: live.callSid, reason: "pacer drained greeting" });
            console.log("[AI-VOICE] greetingAudioDone=true on pacer drain | awaitingUserAnswer armed", { callSid: live.callSid });
            armSilenceWatchdog(twilioWs, live, POST_GREETING_SILENCE_MS, "pacer drained greeting");
          }
        }
        maybePerformPendingLiveTransfer(twilioWs, live, "pacer drained");
        if (!live.transferStarting && !live.transferInProgress) {
          void replayPendingCommittedTurn(twilioWs, live, "pacer drained");
        }
        return;
      }

      // OpenAI not done, but we don't have a full frame yet:
      // - If we have *some* bytes, pad to full frame and send now (reduces start-lag + prevents underrun clicks).
      // - If we have none, send μ-law silence to maintain cadence.
      if (buf.length > 0) {
        const frame = Buffer.alloc(TWILIO_FRAME_BYTES, 0xFF);
        buf.copy(frame, 0, 0, Math.min(buf.length, TWILIO_FRAME_BYTES));
        live.outboundMuLawBuffer = Buffer.alloc(0);

        twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid: live.streamSid,
            media: { payload: frame.toString("base64") },
          })
        );
      } else {
        const silence = Buffer.alloc(TWILIO_FRAME_BYTES, 0xFF);
        twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid: live.streamSid,
            media: { payload: silence.toString("base64") },
          })
        );
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

function clearSilenceWatchdog(state: CallState, reason: string) {
  try {
    if (state.silenceWatchdog) {
      clearTimeout(state.silenceWatchdog);
      state.silenceWatchdog = null;
      console.log("[AI-VOICE][SILENCE] cleared |", reason);
    }
  } catch {}
}

function armSilenceWatchdog(
  ws: WebSocket,
  state: CallState,
  ms: number,
  reason: string
) {
  clearSilenceWatchdog(state, `re-arm before ${reason}`);

  if (state.phase === "ended") return;
  if (!state.callSid) return;

  state.silenceWatchdog = setTimeout(() => {
    try {
      const live = calls.get(ws);
      if (!live) return;
      if (live.phase === "ended") return;

      console.log("[AI-VOICE][SILENCE] timeout fired — closing call", {
        callSid: live.callSid,
        phase: live.phase,
        reason,
        ms,
      });

      live.phase = "ended";
      live.finalOutcomeSent = live.finalOutcomeSent || false;
      stopOutboundPacer(ws, live, `silence timeout (${reason})`);
      safelyCloseOpenAi(live, `silence timeout (${reason})`);
    } catch (err: any) {
      console.warn("[AI-VOICE][SILENCE] timeout close failed:", err?.message || err);
    }
  }, ms);

  console.log("[AI-VOICE][SILENCE] armed |", { callSid: state.callSid, reason, ms });
}

function finalizeGreetingAdvance(state: CallState, reason: string) {
  if (!state.greetingAdvancePending) return;

  try {
    const nextIndex =
      typeof state.greetingAdvanceNextIndex === "number"
        ? state.greetingAdvanceNextIndex
        : 0;
    const nextPhase = state.greetingAdvanceNextPhase || "in_call";

    state.scriptStepIndex = nextIndex;
    state.phase = nextPhase;
    state.awaitingUserAnswer = true;
    state.awaitingAnswerForStepIndex = Math.max(0, nextIndex - 1);

    console.log("[AI-VOICE][GREETING] advanced after greeting audio completion", {
      callSid: state.callSid,
      reason,
      scriptStepIndex: state.scriptStepIndex,
      awaitingAnswerForStepIndex: state.awaitingAnswerForStepIndex,
    });
  } catch {
    state.phase = "in_call";
    state.awaitingUserAnswer = true;
    state.awaitingAnswerForStepIndex = 0;
  } finally {
    state.greetingAdvancePending = false;
    state.greetingAdvanceNextIndex = undefined;
    state.greetingAdvanceNextPhase = undefined;
  }
}

function maybePerformPendingLiveTransfer(ws: WebSocket, state: CallState, reason: string) {
  if (!state.pendingLiveTransferAfterLine) return;
  if (state.phase === "ended") return;
  if (state.waitingForResponse || state.responseInFlight || state.aiSpeaking) return;

  state.pendingLiveTransferAfterLine = false;
  state.transferStarting = true;
  state.pendingCommittedTurn = null;
  try {
    console.log("[AI-VOICE][LIVE-TRANSFER] starting deferred transfer after intro", {
      callSid: state.callSid,
      reason,
    });
  } catch {}
  void performLiveTransfer(ws, state);
}



async function replayPendingCommittedTurn(
  twilioWs: WebSocket,
  state: CallState,
  reason: string
) {
  try {
    if (state.phase === "ended") return;
    if (state.transferStarting || state.transferInProgress) {
      state.pendingCommittedTurn = null;
      return;
    }
    const pending = state.pendingCommittedTurn;
    if (!pending) return;

    // Only replay when the AI is truly done speaking/draining and we are able to create a response
    if (state.aiSpeaking) return;
    if (state.waitingForResponse || state.responseInFlight) return;
    if (!state.openAiWs || !state.openAiReady) return;
    if (state.voicemailSkipArmed) {
      state.pendingCommittedTurn = null;
      return;
    }

    // Restore the exact accepted input for the turn
    const restoredTranscript = String(pending.bestTranscript || "").trim();
    const restoredAudioMs = Number(pending.audioMs || 0);
    const pendingAgeMs = Date.now() - Number((pending as any).atMs || 0);

    // ✅ CRITICAL:
    // Do NOT clear pendingCommittedTurn until we actually have transcript text.
    // Otherwise we replay with stale lastUserTranscript and the stepper can skip / mis-handle turns.
    //
    // Exception: greeting reply can be audio-only (no transcript yet) if the user clearly spoke.
    // isGreetingReply computed above (do not redeclare)
    if (!restoredTranscript) {
      const strongAudio = restoredAudioMs >= 900; // ~0.9s indicates real speech (not comfort noise)
      const allowGreetingAudioOnly = state.phase === "awaiting_greeting_reply" && strongAudio;
      if (!allowGreetingAudioOnly) {
        // Wait for transcription delta/completed to populate pending.bestTranscript and replay again.
        // If it never arrives, drop the pending safely after ~1.8s (do NOT advance steps).
        if (pendingAgeMs < 1800) return;
        state.pendingCommittedTurn = null;
        return;
      }
    }

    // Clear pending now (prevents double replay) — ONLY after we have transcript or allowed greeting audio-only.
    state.pendingCommittedTurn = null;

    if (restoredTranscript) state.lastUserTranscript = restoredTranscript;
    if (restoredAudioMs > 0) state.userAudioMsBuffered = restoredAudioMs;

    console.log("[AI-VOICE][TURN-GATE][REPLAY]", {
      callSid: state.callSid,
      streamSid: state.streamSid,
      reason,
      restoredLen: restoredTranscript ? restoredTranscript.length : 0,
      restoredText: restoredTranscript || "",
      restoredAudioMs,
      phase: state.phase,
    });

    // ✅ Re-run the same commit logic path by directly invoking the same response.create decision logic
    // We do NOT touch audio streaming; we only create a response now that drain is complete.

    let lastUserText = String(state.lastUserTranscript || "").trim();
    const turnFinalization = shouldDeferTurnRouting(state, lastUserText, "replay", {
      reason,
      audioMs: restoredAudioMs,
      isFinalTranscript: String(reason || "").toLowerCase().includes("completed"),
    });
    if (turnFinalization.defer) {
      state.pendingCommittedTurn = {
        bestTranscript: turnFinalization.transcript,
        audioMs: restoredAudioMs,
        atMs: Date.now(),
      };
      state.lastUserTranscript = turnFinalization.transcript;
      return;
    }
    lastUserText = turnFinalization.transcript;
    if (lastUserText) state.lastUserTranscript = lastUserText;
    const objectionKind = lastUserText ? detectObjection(lastUserText) : null;
    const questionKind = !objectionKind && lastUserText ? detectQuestionKindForTurn(lastUserText) : null;
    const objectionOrQuestionKind = objectionKind || questionKind;

    // Ensure script steps loaded
    if (!state.scriptSteps || state.scriptSteps.length === 0) {
      try {
        const selectedScript = getSelectedScriptText(state.context!);
        state.scriptSteps = extractScriptStepsFromSelectedScript(selectedScript);
        state.scriptStepIndex = 0;
      } catch {
        state.scriptSteps = [];
        state.scriptStepIndex = 0;
      }
    }

    const idx = typeof state.scriptStepIndex === "number" ? state.scriptStepIndex : 0;
    const steps = state.scriptSteps || [];

    const currentStepLine = steps[idx] || getBookingFallbackLine(state.context!);
    const expectedAnswerIdx = Math.max(0, idx - 1);
    const expectedStepLine = steps[expectedAnswerIdx] || currentStepLine;
    const stepType = classifyStepType(expectedStepLine);

    const humanPause = async () => {
      try {
        await sleep(randInt(120, 220));
      } catch {}
    };

    const now = Date.now();
    const lastCreateAt = Number(state.lastResponseCreateAtMs || 0);
    if (now - lastCreateAt < 150) return;

    const turnKey = buildCommittedTurnKey(state, lastUserText, restoredAudioMs, expectedAnswerIdx);
    if (shouldSkipShortWindowDuplicateTurn(state, lastUserText, expectedAnswerIdx)) return;

    if (await handleConversationTurn(state, lastUserText, "replay", { idx, steps, stepType, expectedAnswerIdx }, turnKey, humanPause)) return;

    if (state.pendingLiveTransferAvailabilityConfirm) {
      const _ltClearSd = String(state.selectedDay || "").trim().toLowerCase();
      const _ltClearExplicit = extractExplicitDaySelection(lastUserText);
      if (objectionOrQuestionKind || _ltClearSd === "today" || _ltClearSd === "tomorrow" || _ltClearExplicit === "today" || _ltClearExplicit === "tomorrow") {
        state.pendingLiveTransferAvailabilityConfirm = false;
        state.pendingLiveTransferAvailabilityAttempts = 0;
      } else {
      if (!markCommittedTurnHandled(state, turnKey, "replay live-transfer availability")) return;
      const explicitDay = extractExplicitDaySelection(lastUserText);
      const rememberedDay = String(state.selectedDay || "").trim().toLowerCase();
      const selectedAvailabilityDay =
        explicitDay === "today" || explicitDay === "tomorrow"
          ? explicitDay
          : rememberedDay === "today" || rememberedDay === "tomorrow"
            ? (rememberedDay as "today" | "tomorrow")
            : null;
      const immediateYes = hasImmediateTransferConfirmation(lastUserText);
      const schedulingPreference = isImmediateTransferSchedulingPreference(lastUserText);
      const yesNow = !selectedAvailabilityDay && (immediateYes || (isLiveTransferAvailabilityYes(lastUserText) && !schedulingPreference));
      const noLater = !yesNow && (!!selectedAvailabilityDay || schedulingPreference || isLiveTransferAvailabilityNo(lastUserText));
      try {
        console.log("[AI-VOICE][LIVE-TRANSFER-INTENT]", {
          source: "replay",
          yesNow,
          noLater,
          explicitDay: explicitDay || null,
          reason: yesNow ? "immediate_transfer" : noLater ? "scheduling_preference" : "ambiguous",
        });
      } catch {}
      const nextAvailabilityAttempts = !yesNow && !noLater
        ? Number(state.pendingLiveTransferAvailabilityAttempts || 0) + 1
        : 0;
      const escapeAvailabilityLoop = !yesNow && !noLater && nextAvailabilityAttempts >= 3;
      const userAlreadySaidWhen = isDayReferenceMentioned(lastUserText) || isTimeWindowMentioned(lastUserText);
      if (selectedAvailabilityDay) {
        state.selectedDay = selectedAvailabilityDay;
      }
      let lineToSay = yesNow
        ? getLiveTransferTryingLine(state.context!)
        : noLater || escapeAvailabilityLoop
          ? noLater || userAlreadySaidWhen
            ? getTimeOfferLine(state.context!, 0, selectedAvailabilityDay || pickDayHint(lastUserText, ""), pickTimeWindowHint(lastUserText, ""), lastUserText)
            : "No problem. Would later today or tomorrow be better?"
          : getLiveTransferAvailabilityLine(state.context!);
      const _guard_rplt = applyAiOutputRepeatGuard(state, lineToSay, {
        userText: lastUserText,
        routeKind: yesNow ? "live_transfer_try" : noLater ? "time_offer" : "live_transfer_availability",
        objective: yesNow ? "transfer_now" : "schedule_time",
      });
      lineToSay = _guard_rplt.lineToSay;
      for (const [k, v] of Object.entries(_guard_rplt.stateWrites)) { (state as any)[k] = v; }
      const instr = buildExactScriptLineInstruction(lineToSay, {
        userText: lastUserText || "",
        recentExchanges: state.recentExchanges,
        scope: state.context ? getScopeLabelForScriptKey(state.context.scriptKey) : "life insurance",
        agent: state.context ? (state.context.agentName || "the agent").split(" ")[0] : "the agent",
        leadName: state.context ? (state.context.clientFirstName || "there") : "there",
      });

      if (lastUserText) pushExchange(state, "user", lastUserText, expectedAnswerIdx);
      pushExchange(state, "ai", lineToSay, expectedAnswerIdx);

      state.pendingLiveTransferAvailabilityConfirm = !yesNow && !noLater && !escapeAvailabilityLoop;
      state.pendingLiveTransferAvailabilityAttempts = state.pendingLiveTransferAvailabilityConfirm ? nextAvailabilityAttempts : 0;
      state.awaitingUserAnswer = false;
      state.awaitingAnswerForStepIndex = undefined;
      state.userAudioMsBuffered = 0;
      state.lastUserTranscript = "";
      state.lowSignalCommitCount = 0;
      state.repromptCountForCurrentStep = 0;

      setWaitingForResponse(state, true, yesNow ? "response.create (live-transfer try)" : "response.create (live-transfer later)");
      setAiSpeaking(state, true, yesNow ? "response.create (live-transfer try)" : "response.create (live-transfer later)");
      setResponseInFlight(state, true, yesNow ? "response.create (live-transfer try)" : "response.create (live-transfer later)");
      state.outboundOpenAiDone = false;
      state.lastPromptSentAtMs = Date.now();
      state.lastPromptLine = lineToSay;
      state.lastResponseCreateAtMs = Date.now();
      recordPassiveRouteMemory(state, {
        source: "replay",
        routeKind: _guard_rplt.routeKind,
        routeReason: yesNow ? "availability_yes" : noLater ? "availability_no" : escapeAvailabilityLoop ? "availability_escape" : "availability_ambiguous",
        userText: lastUserText,
        lineToSay,
        turnKey,
      });
      noteAiOutputSpoken(state, lineToSay);
      state.openAiWs.send(JSON.stringify(buildRealtimeResponseCreate(instr)));

      state.phase = "in_call";
      if (yesNow) {
        state.liveTransferIntroSpoken = true;
        state.pendingLiveTransferAfterLine = true;
      } else if (noLater || escapeAvailabilityLoop) {
        state.scriptStepIndex = Math.min(idx + 1, Math.max(0, steps.length - 1));
        state.awaitingUserAnswer = true;
        state.awaitingAnswerForStepIndex = Math.max(0, state.scriptStepIndex - 1);
        if (userAlreadySaidWhen) {
          state.timeOfferCountForStepIndex = state.scriptStepIndex;
          state.timeOfferCount = 1;
        }
      } else {
        // Fallthrough: ambiguous response (e.g. "what?") — re-ask the same availability question.
        // Re-arm so the next commit is accepted and routed back into this block.
        state.awaitingUserAnswer = true;
        state.awaitingAnswerForStepIndex = expectedAnswerIdx;
      }
      return;
      }
    }


  } catch (err: any) {
    console.warn("[AI-VOICE][TURN-GATE][REPLAY] failed (non-blocking):", {
      callSid: state.callSid,
      error: err?.message || err,
      reason,
    });
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
    clearSilenceWatchdog(state, `close openai (${why})`);
    state.outboundOpenAiDone = true;
    state.outboundMuLawBuffer = Buffer.alloc(0);
    state.openAiReady = false;
    state.openAiConfigured = false;
    state.phase = "ended";
    setWaitingForResponse(state, false, `close openai (${why})`);
    setAiSpeaking(state, false, `close openai (${why})`);
    setResponseInFlight(state, false, `close openai (${why})`);

    if (state.openAiWs) {
      try {
        state.openAiWs.close();
      } catch {}
      state.openAiWs = undefined;
    }
  } catch {}
}

/**
 * ============================
 * ✅ SCRIPT DRIFT DIAGNOSTICS
 * ============================
 * We must NOT log private lead notes.
 * So we redact the "- Notes:" line when printing prompt snippets.
 */
function redactPromptForLogs(prompt: string): string {
  const p = String(prompt || "");
  // base prompt uses single-line notes: "- Notes: <...>"
  return p.replace(/- Notes:\s.*$/gm, "- Notes: [REDACTED]");
}

function safeSliceHead(s: string, n: number): string {
  const t = String(s || "");
  return t.length <= n ? t : t.slice(0, n);
}

function safeSliceTail(s: string, n: number): string {
  const t = String(s || "");
  return t.length <= n ? t : t.slice(Math.max(0, t.length - n));
}

function hash8(s: string): string {
  try {
    const t = String(s || "");
    let h = 0;
    for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).slice(0, 8);
  } catch {
    return "00000000";
  }
}

function normalizeTurnTextForKey(textRaw: string): string {
  return String(textRaw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCommittedTurnKey(
  state: CallState,
  transcriptRaw: string,
  audioMsRaw: number,
  expectedAnswerIdx: number
): string {
  const transcript = normalizeTurnTextForKey(transcriptRaw);
  const audioBucket = Math.floor(Math.max(0, Number(audioMsRaw || 0)) / 500);
  return [
    state.phase || "",
    String(expectedAnswerIdx),
    transcript || "(no-text)",
    String(audioBucket),
  ].join("|");
}

function shouldSkipShortWindowDuplicateTurn(
  state: CallState,
  transcriptRaw: string,
  expectedAnswerIdx: number
): boolean {
  const transcript = normalizeTurnTextForKey(transcriptRaw);
  if (!transcript) return false;

  const key = [String(expectedAnswerIdx), transcript].join("|");
  const now = Date.now();
  const lastKey = String(state.lastDuplicateGuardKey || "");
  const lastAt = Number(state.lastDuplicateGuardAtMs || 0);

  if (lastKey === key && lastAt > 0 && now - lastAt <= 2000) {
    try {
      console.log("[AI-VOICE][TURN-GATE] short-window duplicate skipped", {
        callSid: state.callSid,
        turnHash: hash8(key),
        msSinceLast: now - lastAt,
      });
    } catch {}
    return true;
  }

  state.lastDuplicateGuardKey = key;
  state.lastDuplicateGuardAtMs = now;
  return false;
}

function isCallerAskingForRepeat(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  return (
    t.includes("what was that") ||
    t.includes("say that again") ||
    t.includes("repeat that") ||
    t.includes("repeat it") ||
    t.includes("i didnt hear") ||
    t.includes("i didn t hear") ||
    t.includes("i couldn t hear") ||
    t.includes("i couldnt hear") ||
    t.includes("what did you say")
  );
}

function normalizeAiLineForRepeat(textRaw: string): string {
  return normalizeTurnTextForKey(textRaw)
    .replace(/\b(got it|okay|ok|perfect|sure|no worries|totally fair)\b/g, "")
    .replace(/\b(bryson|agent|licensed agent|your agent)\b/g, "agent")
    .replace(/\s+/g, " ")
    .trim();
}

function isStep2BookingFrameLine(lineRaw: string): boolean {
  const t = normalizeAiLineForRepeat(lineRaw);
  return (
    t.includes("scheduled for a quick call") &&
    (t.includes("later today") || t.includes("tomorrow")) &&
    (t.includes("right now") || t.includes("on the line") || t.includes("work better"))
  );
}

function aiLinesAreSubstantiallySame(aRaw: string, bRaw: string): boolean {
  const a = normalizeAiLineForRepeat(aRaw);
  const b = normalizeAiLineForRepeat(bRaw);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 40 && b.length >= 40 && (a.includes(b) || b.includes(a))) return true;
  const aWords = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const bWords = b.split(/\s+/).filter(w => w.length > 2);
  if (aWords.size < 6 || bWords.length < 6) return false;
  const overlap = bWords.filter(w => aWords.has(w)).length;
  return overlap / Math.max(1, Math.min(aWords.size, bWords.length)) >= 0.78;
}

function recentAiLinesForRepeatCheck(state: CallState): string[] {
  const lines: string[] = [];
  const lastPrompt = String(state.lastPromptLine || "").trim();
  if (lastPrompt) lines.push(lastPrompt);
  const exchanges = state.recentExchanges || [];
  for (const ex of exchanges.slice(-8).reverse()) {
    if (ex.role === "ai" && ex.text) lines.push(ex.text);
    if (lines.length >= 4) break;
  }
  const lastBookingFrame = String(state.lastBookingFrameNorm || "").trim();
  if (lastBookingFrame) lines.push(lastBookingFrame);
  return lines;
}

function buildNonRepeatedStateAwareLine(
  state: CallState,
  attemptedLine: string,
  userText: string,
  routeKind: string,
  objective: string
): { lineToSay: string; routeKind: string; objective: string; stateWrites: Record<string, unknown> } {
  const ctx = state.context;
  const raw = String(userText || "");
  const liveTransferEnabled = !!(ctx as any)?.liveTransferEnabled && !!(ctx as any)?.liveTransferPhone;
  const explicitNowIntent =
    !!ctx &&
    liveTransferEnabled &&
    !isImmediateTransferSchedulingPreference(raw) &&
    (hasImmediateTransferConfirmation(raw) || hasExplicitAgentTransferCommand(raw));
  if (explicitNowIntent) {
    return {
      lineToSay: getLiveTransferTryingLine(ctx),
      routeKind: `${routeKind}_repeat_guard_transfer`,
      objective: "start_live_transfer_after_intro",
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        liveTransferIntroSpoken: true,
        pendingLiveTransferAfterLine: true,
        awaitingUserAnswer: false,
        awaitingAnswerForStepIndex: undefined,
      },
    };
  }

  if (ctx) {
    const explicitDay = pickDayHint(raw, "");
    const namedDay: string | null = extractNamedWeekday(raw.toLowerCase());
    const rememberedDay = String(state.selectedDay || "").trim().toLowerCase();
    const rememberedNamedDay = rememberedDay && rememberedDay !== "today" && rememberedDay !== "tomorrow" ? rememberedDay : null;
    const dayHint: string | null =
      explicitDay === "today" || explicitDay === "tomorrow"
        ? explicitDay
        : rememberedDay === "today" || rememberedDay === "tomorrow"
          ? rememberedDay
          : namedDay || rememberedNamedDay
            || pickDayHint(raw, String(state.lastAcceptedUserText || ""));
    const windowHint = pickTimeWindowHint(raw, String(state.lastAcceptedUserText || ""));
    if (dayHint || windowHint || isTimeIndecisionOrAvailability(raw)) {
      const timeStepIndex = Math.max(Number(state.scriptStepIndex || 0), Math.min(2, Math.max(0, (state.scriptSteps || []).length - 1)));
      const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(timeStepIndex);
      const n = sameStep ? Number(state.timeOfferCount || 0) + 1 : 1;
      return {
        lineToSay: getTimeOfferLine(ctx, n, dayHint, windowHint, raw),
        routeKind: `${routeKind}_repeat_guard_time_offer`,
        objective: "time_selection",
        stateWrites: {
          ...(dayHint ? { selectedDay: dayHint } : {}),
          ...(windowHint ? { selectedWindow: windowHint } : {}),
          pendingLiveTransferAvailabilityConfirm: false,
          pendingLiveTransferAvailabilityAttempts: 0,
          scriptStepIndex: timeStepIndex,
          timeOfferCountForStepIndex: timeStepIndex,
          timeOfferCount: n + 1,
          awaitingUserAnswer: true,
          awaitingAnswerForStepIndex: Math.max(0, timeStepIndex - 1),
        },
      };
    }
  }

  const questionKind = (() => {
    try { return detectQuestionKindForTurn(raw); } catch { return null; }
  })();
  if (questionKind && ctx) {
    const agentFirst = getAgentFirstName(ctx);
    const pivot = getStateAwareClosingPivot(state);
    const objKindCheck = (() => { try { return detectObjection(raw); } catch { return null; } })();
    const isIdentityQuestion = objKindCheck === "are_you_ai" || objKindCheck === "confused_identity" || objKindCheck === "scam";
    const answer =
      questionKind === "how_much"
        ? `I get why you'd ask — ${agentFirst} covers exact cost on the call.`
        : questionKind === "what_entails" || isHowLongDurationQuestion(raw)
          ? "It is usually about 5 to 10 minutes."
          : isIdentityQuestion
            ? `Yes — I'm a virtual assistant helping schedule the appointment. ${agentFirst} is the licensed agent on the call.`
            : ctx
              ? getVerticalProductAnswer(ctx)
              : `${agentFirst} can answer that clearly on the call.`;
    return {
      lineToSay: `${answer} ${pivot}`,
      routeKind: `${routeKind}_repeat_guard_question`,
      objective: "answer_then_return_to_scheduling",
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: Math.max(0, Number(state.scriptStepIndex || 1) - 1),
      },
    };
  }

  if (isStep2BookingFrameLine(attemptedLine) || Number(state.step2BookingFrameAskedCount || 0) > 0) {
    return {
      lineToSay: liveTransferEnabled
        ? "Which works better for you — later today, tomorrow, or right now?"
        : "Which works better for you — later today or tomorrow?",
      routeKind: `${routeKind}_repeat_guard_clarify`,
      objective: "clarify_scheduling_choice",
      stateWrites: {
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: Math.max(0, Number(state.scriptStepIndex || 1) - 1),
      },
    };
  }

  // If the current script step has not been answered yet,
  // re-ask it instead of falling back to scheduling.
  try {
    const stepIdx = Number(
      state.awaitingAnswerForStepIndex ??
      (state.scriptStepIndex || 0)
    );
    const steps = state.scriptSteps || [];
    const unansweredStep = steps[stepIdx];
    if (
      unansweredStep &&
      unansweredStep.trim() &&
      state.awaitingUserAnswer === true
    ) {
      return {
        lineToSay: unansweredStep.trim(),
        routeKind: `${routeKind}_step_reask`,
        objective: "reask_current_step",
        stateWrites: {
          awaitingUserAnswer: true,
          awaitingAnswerForStepIndex: stepIdx,
        },
      };
    }
  } catch {}

  return {
    lineToSay: "What works best for you?",
    routeKind: `${routeKind}_repeat_guard_clarify`,
    objective: objective || "clarify_current_objective",
    stateWrites: {
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: Math.max(0, Number(state.scriptStepIndex || 1) - 1),
    },
  };
}

function applyAiOutputRepeatGuard(
  state: CallState,
  lineRaw: string,
  args: {
    userText: string;
    routeKind: string;
    objective: string;
  }
): { lineToSay: string; routeKind: string; objective: string; stateWrites: Record<string, unknown>; suppressed: boolean } {
  const lineToSay = String(lineRaw || "").trim();
  if (!lineToSay || isCallerAskingForRepeat(args.userText)) {
    return { lineToSay, routeKind: args.routeKind, objective: args.objective, stateWrites: {}, suppressed: false };
  }

  const recentLines = recentAiLinesForRepeatCheck(state);
  const sameRecentLine = recentLines.some(prev => aiLinesAreSubstantiallySame(prev, lineToSay));
  const sameRouteObjective =
    !!state.lastRouteKind &&
    state.lastRouteKind === args.routeKind &&
    !!state.lastRouteReason &&
    state.lastRouteReason === args.objective;
  const repeatsStep2Frame =
    isStep2BookingFrameLine(lineToSay) &&
    Number(state.step2BookingFrameAskedCount || 0) > 0;

  if (!sameRecentLine && !sameRouteObjective && !repeatsStep2Frame) {
    return { lineToSay, routeKind: args.routeKind, objective: args.objective, stateWrites: {}, suppressed: false };
  }

  const replacement = buildNonRepeatedStateAwareLine(state, lineToSay, args.userText, args.routeKind, args.objective);
  try {
    console.log("[AI-VOICE][OUTPUT-REPEAT-GUARD] replaced repeated line", {
      callSid: state.callSid,
      routeKind: args.routeKind,
      replacementRouteKind: replacement.routeKind,
      attemptedHash: hash8(lineToSay),
      replacementHash: hash8(replacement.lineToSay),
      repeatsStep2Frame,
      sameRecentLine,
      sameRouteObjective,
    });
  } catch {}
  return { ...replacement, suppressed: true };
}

function noteAiOutputSpoken(state: CallState, lineRaw: string): void {
  const line = String(lineRaw || "").trim();
  if (!line) return;
  if (isStep2BookingFrameLine(line)) {
    state.step2BookingFrameAskedAtMs = Date.now();
    state.step2BookingFrameAskedCount = Number(state.step2BookingFrameAskedCount || 0) + 1;
    state.lastBookingFrameNorm = normalizeAiLineForRepeat(line);
  }
}

function markCommittedTurnHandled(state: CallState, turnKey: string, reason: string): boolean {
  if (!turnKey) return true;
  if (state.lastHandledTurnKey === turnKey) {
    try {
      console.log("[AI-VOICE][TURN-GATE] duplicate committed turn skipped", {
        callSid: state.callSid,
        reason,
        turnHash: hash8(turnKey),
      });
    } catch {}
    return false;
  }
  state.lastHandledTurnKey = turnKey;
  return true;
}

function mergeDeferredTurnText(previousRaw: string, nextRaw: string): string {
  const previous = String(previousRaw || "").replace(/\s+/g, " ").trim();
  const next = String(nextRaw || "").replace(/\s+/g, " ").trim();
  if (!previous) return next;
  if (!next) return previous;
  const p = previous.toLowerCase();
  const n = next.toLowerCase();
  if (n.includes(p)) return next;
  if (p.includes(n)) return previous;
  return `${previous} ${next}`.replace(/\s+/g, " ").trim();
}

function isHardCompleteTurnIntent(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  if (
    t.includes("stop calling") ||
    t.includes("do not call") ||
    t.includes("don t call") ||
    t.includes("dont call") ||
    t.includes("remove me") ||
    t.includes("wrong number")
  ) return true;
  const obj = detectObjection(t);
  if (obj === "not_interested" || obj === "scam") return true;
  if (extractExplicitDaySelection(t) === "today" || extractExplicitDaySelection(t) === "tomorrow") return true;
  if (t.includes("later today") || t.includes("call me later")) return true;
  if (hasImmediateTransferConfirmation(t) || hasExplicitAgentTransferCommand(t)) return true;
  if (isExactClockTimeMentioned(t)) return true;
  return false;
}

function looksLikeIncompleteTurnPrefix(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return true;
  const prefixes = new Set([
    "yeah", "yep", "yes", "ok", "okay", "well", "so", "um", "uh", "hmm",
    "i mean", "i guess", "like", "wait", "hold on", "the thing is",
    "what i m", "what im", "what i am", "i was", "i just", "i don t",
    "i dont", "but", "yeah but", "okay but", "well i mean"
  ]);
  if (prefixes.has(t)) return true;
  if (/^(yeah|yes|yep|ok|okay|well|so|um|uh|wait|but)\s*$/i.test(t)) return true;
  if (/\b(and|but|so|because|if|when|while|that|to|for|with|about)$/i.test(t)) return true;
  if (/^(well|so|i mean|the thing is|what i'?m|what im|what i am)\b/i.test(t) && t.split(/\s+/).length <= 5) return true;
  return false;
}

function hasConversationalContinuationTail(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return true;
  return (
    /[,;:]$/.test(t) ||
    /\b(and|but|so|because|if|when|while|that|to|for|with|about)$/i.test(t) ||
    /\b(i mean|the thing is|what i'?m trying|what im trying|let me|hold on)$/i.test(t)
  );
}

function shouldDeferTurnRouting(
  state: CallState,
  transcriptRaw: string,
  source: "main" | "replay",
  metadata: {
    isFinalTranscript?: boolean;
    reason?: string;
    audioMs?: number;
  } = {}
): { defer: boolean; transcript: string; reason?: string } {
  const incoming = String(transcriptRaw || "").replace(/\s+/g, " ").trim();
  const merged = mergeDeferredTurnText(state.deferredTurnTranscript || "", incoming);
  if (!merged) return { defer: false, transcript: incoming };

  if (isHardCompleteTurnIntent(merged)) {
    state.deferredTurnTranscript = "";
    state.deferredTurnAtMs = undefined;
    state.deferredTurnSource = undefined;
    state.deferredTurnReason = undefined;
    return { defer: false, transcript: merged };
  }

  const now = Date.now();
  const transcriptCompletedRecently =
    !!metadata.isFinalTranscript ||
    (Number(state.lastTranscriptCompletedAtMs || 0) > 0 && now - Number(state.lastTranscriptCompletedAtMs || 0) <= 1200);
  const deltaRecently =
    Number(state.lastTranscriptDeltaAtMs || 0) > 0 && now - Number(state.lastTranscriptDeltaAtMs || 0) <= 300;
  const stoppedRecently =
    Number(state.lastUserSpeechStoppedAtMs || 0) > 0 && now - Number(state.lastUserSpeechStoppedAtMs || 0) <= 650;
  const trailingSilenceEnough =
    Number(state.lastUserSpeechStoppedAtMs || 0) > 0 && now - Number(state.lastUserSpeechStoppedAtMs || 0) >= 650;
  const reason = String(metadata.reason || "").toLowerCase();
  const replayFromDelta = source === "replay" && reason.includes("delta") && !transcriptCompletedRecently;

  const shortLikelyIncomplete = merged.length <= 12 && looksLikeIncompleteTurnPrefix(merged);
  const continuationTail = hasConversationalContinuationTail(merged);
  const stillGrowing = deltaRecently && !transcriptCompletedRecently;

  const shouldDefer =
    replayFromDelta ||
    stillGrowing ||
    (!transcriptCompletedRecently && stoppedRecently) ||
    (!transcriptCompletedRecently && !trailingSilenceEnough && (shortLikelyIncomplete || continuationTail));

  if (!shouldDefer) {
    state.deferredTurnTranscript = "";
    state.deferredTurnAtMs = undefined;
    state.deferredTurnSource = undefined;
    state.deferredTurnReason = undefined;
    return { defer: false, transcript: merged };
  }

  state.deferredTurnTranscript = merged;
  state.deferredTurnAtMs = now;
  state.deferredTurnSource = source;
  state.deferredTurnReason =
    replayFromDelta ? "partial_delta" :
    stillGrowing ? "transcript_still_growing" :
    stoppedRecently ? "awaiting_trailing_silence_or_final" :
    shortLikelyIncomplete ? "short_incomplete_prefix" :
    "continuation_tail";

  try {
    console.log("[AI-VOICE][TURN-FINALIZE] deferred routing", {
      callSid: state.callSid,
      source,
      reason: state.deferredTurnReason,
      transcriptLen: merged.length,
      isFinalTranscript: !!metadata.isFinalTranscript,
      stoppedRecently,
      deltaRecently,
    });
  } catch {}

  return { defer: true, transcript: merged, reason: state.deferredTurnReason };
}

function extractOfferedSlotsFromLine(lineRaw: string): string[] {
  const line = String(lineRaw || "");
  const matches = line.match(/\b\d{1,2}:\d{2}\s?(?:am|pm)\b/gi) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const normalized = String(raw || "").replace(/\s+/g, "").toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function looksLikeGeneratedTimeOfferLine(lineRaw: string): boolean {
  const line = String(lineRaw || "").toLowerCase();
  if (!line) return false;
  const slots = extractOfferedSlotsFromLine(line);
  return slots.length >= 2 && (
    line.includes("availability at") ||
    line.includes("which would work") ||
    line.includes("which is easier") ||
    line.includes("put you down") ||
    line.includes("lock in")
  );
}

function extractExplicitDaySelection(textRaw: string): "today" | "tomorrow" | string | null {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return null;
  if (t.includes("today") || t.includes("later today") || t.includes("tonight")) return "today";
  if (t.includes("tomorrow")) return "tomorrow";
  const dayMatch = t.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|next week)\b/);
  return dayMatch?.[1] || null;
}

function extractNamedWeekday(textRaw: string): string | null {
  const t = String(textRaw || "").toLowerCase();
  const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  for (const d of days) {
    if (new RegExp(`\\b${d}\\b`).test(t)) {
      const isNext = /\bnext\b/.test(t);
      return isNext ? `next ${d}` : d;
    }
  }
  if (/\b(this weekend|weekend)\b/.test(t)) return "this weekend";
  if (/\b(later this week|later in the week|sometime this week)\b/.test(t)) return "later this week";
  if (/\bnext week\b/.test(t)) return "next week";
  return null;
}

function shouldRouteDaySelectionToTimeOffer(
  state: CallState,
  lastUserText: string,
  idx: number,
  expectedAnswerIdx: number,
  steps: string[]
): boolean {
  try {
    if (state.phase !== "in_call") return false;
    if (state.pendingLiveTransferAvailabilityConfirm) return false;

    const text = String(lastUserText || "").trim();
    const normalized = normalizeTurnTextForKey(text);
    if (!normalized) return false;
    if (hasExplicitLiveTransferIntent(text)) return false;
    if (isExactClockTimeMentioned(text)) return false;
    if (detectObjection(text)) return false;
    if (
      normalized.includes("wrong number") ||
      normalized.includes("no coverage") ||
      normalized.includes("stop calling") ||
      normalized.includes("do not call")
    ) return false;

    const explicitDay = extractExplicitDaySelection(text);
    const rememberedDay = String(state.selectedDay || "").trim().toLowerCase();
    const hasRememberedDay = rememberedDay === "today" || rememberedDay === "tomorrow";
    if (!explicitDay && !hasRememberedDay) return false;
    if (!explicitDay && hasRememberedDay && !isTimeIndecisionOrAvailability(text)) return false;

    const currentLine = String(steps[idx] || "");
    const expectedLine = String(steps[expectedAnswerIdx] || "");
    const lastPrompt = String(state.lastPromptLine || "");
    const atBookingFrameStep = idx === 1;
    const promptIsDayChoice =
      isDayChoiceQuestion(currentLine) ||
      isDayChoiceQuestion(expectedLine) ||
      isDayChoiceQuestion(lastPrompt);

    return atBookingFrameStep || promptIsDayChoice;
  } catch {
    return false;
  }
}

function recordPassiveRouteMemory(
  state: CallState,
  args: {
    source: "main" | "replay";
    routeKind: string;
    routeReason?: string;
    userText?: string;
    lineToSay?: string;
    turnKey?: string;
    trackResolvedObjection?: boolean;
  }
) {
  try {
    const userText = String(args.userText || "").trim();
    const lineToSay = String(args.lineToSay || "").trim();
    const sequence = Number(state.routeSequenceId || 0) + 1;
    state.routeSequenceId = sequence;
    state.currentTurnId = args.turnKey ? hash8(args.turnKey) : `${args.source}-${sequence}`;
    state.responseCreateId = `${args.source}-${sequence}-${hash8(`${args.routeKind}|${args.routeReason || ""}|${lineToSay}`)}`;
    state.lastRouteKind = args.routeKind;
    state.lastRouteReason = args.routeReason || "";
    if (args.routeReason) state.lastAnsweredIntent = args.routeReason;

    const dayHint = userText ? extractExplicitDaySelection(userText) : null;
    if (dayHint) state.selectedDay = dayHint;

    if (userText && isExactClockTimeMentioned(userText)) {
      state.selectedTimeText = userText;
    }

    const windowHint = userText ? pickTimeWindowHint(userText, "") : null;
    if (windowHint) state.selectedWindow = windowHint;

    if (args.trackResolvedObjection && args.routeReason) {
      const existing = Array.isArray(state.resolvedObjectionKinds)
        ? state.resolvedObjectionKinds
        : [];
      if (!existing.includes(args.routeReason)) {
        state.resolvedObjectionKinds = [...existing, args.routeReason].slice(-10);
      }
    }

    if (looksLikeGeneratedTimeOfferLine(lineToSay)) {
      state.lastOfferedSlots = extractOfferedSlotsFromLine(lineToSay);
    }

    const payload = {
      routeSequenceId: state.routeSequenceId,
      currentTurnId: state.currentTurnId,
      responseCreateId: state.responseCreateId,
      source: args.source,
      selectedDay: state.selectedDay || null,
      selectedWindow: state.selectedWindow || null,
      selectedTimeText: state.selectedTimeText ? "[captured]" : null,
      lastRouteKind: state.lastRouteKind || null,
      lastRouteReason: state.lastRouteReason || null,
      scriptStepIndex: state.scriptStepIndex,
      awaitingAnswerForStepIndex: state.awaitingAnswerForStepIndex,
      pendingLiveTransferAvailabilityConfirm: !!state.pendingLiveTransferAvailabilityConfirm,
    };

    console.log("[AI-VOICE][MEMORY]", payload);
    console.log("[AI-VOICE][ROUTE]", payload);
  } catch {}
}

function computePromptMarkers(systemPrompt: string, uniqueLine?: string) {
  const p = String(systemPrompt || "");
  const markers = {
    has_REAL_CALL_SCRIPT: p.includes("REAL CALL SCRIPT"),
    has_BOOKING_SCRIPT: p.includes("BOOKING SCRIPT"),
    has_FOLLOW_SCRIPT_EXACTLY: p.includes("FOLLOW THE SCRIPT BELOW EXACTLY"),
    has_BOOKING_SCRIPT_FOLLOW_EXACTLY: p.includes(
      "BOOKING SCRIPT (FOLLOW EXACTLY)"
    ),
    has_unique_line: uniqueLine ? p.includes(uniqueLine) : false,
  };
  return markers;
}

/**
 * ============================
 * ✅ SERVER-DRIVEN STEPPER
 * ============================
 * The model never "remembers" the whole script.
 * On each user turn, we send exactly ONE next script line (1–2 sentences).
 */
function extractScriptStepsFromSelectedScript(selectedScript: string): string[] {
  const raw = String(selectedScript || "");

  // Prefer "Say: "...""
  const steps: string[] = [];
  const pushIf = (s: string) => {
    const t = String(s || "").trim();
    if (!t) return;
    // collapse spaces but keep punctuation
    const one = t.replace(/\s+/g, " ").trim();
    if (!one) return;
    steps.push(one);
  };

  // "Say: "....""
  const sayRe = /Say:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = sayRe.exec(raw))) {
    pushIf(m[1]);
  }

  // "Then ask: "....""
  const thenAskRe = /Then ask:\s*"([^"]+)"/g;
  while ((m = thenAskRe.exec(raw))) {
    pushIf(m[1]);
  }

  // "Then say: "....""
  const thenSayRe = /Then say:\s*"([^"]+)"/g;
  while ((m = thenSayRe.exec(raw))) {
    pushIf(m[1]);
  }

  // If scripts ever change and no matches are found, fallback to a safe booking-only prompt.
  if (steps.length === 0) {
    // NOTE: do not include any other vertical/topic
    pushIf(
      "I’m just calling to get you scheduled for a quick call. Would later today or tomorrow be better?"
    );
  }

  // De-dupe exact repeats while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of steps) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function getGreetingAckPrefix(userTextRaw: string): string {
  const t = String(userTextRaw || "").trim().toLowerCase();
  if (!t) {
    const opts = ["Awesome.", "Perfect.", "Great."];
    return opts[Math.floor(Math.random() * opts.length)];
  }

  if (
    t.includes("bad day") || t.includes("not good") || t.includes("terrible") ||
    t.includes("stressed") || t.includes("pissed") || t.includes("angry") ||
    t.includes("frustrated") || t.includes("annoyed")
  ) {
    const opts = ["Ah, I hear you.", "Hey, sorry about that.", "Yeah, I get it."];
    return opts[Math.floor(Math.random() * opts.length)];
  }

  if (t.includes("busy") || t.includes("at work") || t.includes("can't talk") || t.includes("in a meeting")) {
    const opts = ["No worries, won't take long.", "Yeah for sure, this is quick.", "Got you, I'll be brief."];
    return opts[Math.floor(Math.random() * opts.length)];
  }

  if (
    t == "yes" || t == "yeah" || t == "yep" || t == "yup" ||
    t.includes("i can hear") || t.includes("hear you") ||
    t.includes("yes i can") || t.includes("loud and clear")
  ) {
    const opts = ["Awesome.", "Perfect.", "Great.", "Cool."];
    return opts[Math.floor(Math.random() * opts.length)];
  }

  if (
    t == "no" || t.includes("can't hear") || t.includes("cannot hear") ||
    t.includes("hard to hear") || t.includes("barely hear") ||
    t.includes("what") || t.includes("huh")
  ) {
    const opts = ["Okay.", "My bad.", "Let me try again."];
    return opts[Math.floor(Math.random() * opts.length)];
  }

  const opts = ["Got it.", "Okay.", "Sure.", "Yeah.", "Alright."];
  return opts[Math.floor(Math.random() * opts.length)];
}

function getHumanAckPrefixForStepAnswer(
  prevStepType: StepType | undefined,
  userTextRaw: string
): string {
  const t = String(userTextRaw || "").trim().toLowerCase();
  if (!t) return "";

  // Time answers
  if (prevStepType === "time_question") {
    const opts = ["Perfect.", "Sounds good.", "Great.", "Works for me."];
    return opts[Math.floor(Math.random() * opts.length)];
  }

  if (prevStepType === "yesno_question" || prevStepType === "open_question") {
    if (t.includes("what") || t.includes("huh") || t.includes("confused")) return "";

    const spouseSignals = ["spouse","wife","husband","me and","my wife","my husband","for me","for my","just me","only me","both of us","us both"];
    for (const k of spouseSignals) {
      if (t.includes(k)) {
        const opts = ["Perfect.", "Got it.", "Okay, great.", "Awesome."];
        return opts[Math.floor(Math.random() * opts.length)];
      }
    }

    const opts = ["Got it.", "Okay.", "Sure.", "Alright.", "Makes sense."];
    return opts[Math.floor(Math.random() * opts.length)];
  }

  return "";
}



function isGreetingNegativeHearing(userTextRaw: string): boolean {
  const t = String(userTextRaw || "").trim().toLowerCase();
  if (!t) return false;

  // Strong "can't hear" signals
  if (
    t === "no" ||
    t === "nope" ||
    t === "nah" ||
    t.includes("can't hear") ||
    t.includes("cant hear") ||
    t.includes("cannot hear") ||
    t.includes("can not hear") ||
    t.includes("barely hear") ||
    t.includes("hard to hear") ||
    t.includes("hardly hear") ||
    t.includes("not hearing") ||
    t.includes("i can't hear") ||
    t.includes("i cant hear") ||
    t.includes("i cannot hear") ||
    t.includes("you're breaking up") ||
    t.includes("youre breaking up") ||
    t.includes("cutting out") ||
    t.includes("static") ||
    t.includes("too quiet") ||
    t.includes("quiet") ||
    t.includes("speak up") ||
    t.includes("say that again") ||
    t.includes("repeat that")
  ) {
    return true;
  }

  // Short confusion responses to "can you hear me?"
  // NOTE: "hello" removed — saying hello back is NOT a hearing problem
  if (new Set(["what","huh","pardon","sorry"]).has(t)) return true;
  if (new Set(["what?","huh?","pardon?","sorry?"]).has(t)) return true;

  // Fallback phrase patterns (no regex escapes in TS needed here)
  if (t.includes("can not hear") || t.includes("cannot hear")) return true;
  if (t.includes("difficult to hear") || t.includes("hard to hear")) return true;

  return false;
}

function isTestOrPlaceholderName(name: string): boolean {
  const t = String(name || "").trim().toLowerCase();
  if (!t) return true;
  const placeholders = new Set([
    "test", "testing", "tester", "demo", "sample", "lead", "user",
    "firstname", "first_name", "name", "unknown", "n/a", "na", "none",
    "undefined", "null", "placeholder",
  ]);
  return placeholders.has(t) || t.startsWith("test ") || t.endsWith(" test");
}

function getBookingFallbackLine(ctx: AICallContext): string {
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();
  if (normalizeScriptKey(ctx?.scriptKey) === "kayla_signup") {
    return `Got it — ${agent} can walk you through the full platform on a quick demo call. Want me to get that set up?`;
  }
  return `Got it — my job is just to get you scheduled. ${agent} is the licensed agent who will go over everything with you. Would later today or tomorrow be better?`;
}

// ✅ Discovery-question hard cap (max 2 per call)
// If the model tries to keep asking discovery questions (coverage/underwriting/etc),
// we force booking fallback after 2.
function isDiscoveryQuestionLine(lineRaw: string): boolean {
  const t = String(lineRaw || "").toLowerCase();

  // "spouse/yourself" style discovery
  if (t.includes("for yourself") || t.includes("yourself") || t.includes("spouse")) return true;

  // coverage / underwriting style discovery
  const discovery = [
    "what kind of coverage",
    "what type of coverage",
    "coverage are you looking for",
    "type of coverage",
    "how much coverage",
    "coverage amount",
    "what coverage",
    "mortgage balance",
    "how much do you owe",
    "how much is left",
    "health",
    "medical",
    "smoke",
    "tobacco",
    "medications",
    "height",
    "weight",
    "income",
    "beneficiary",
    "date of birth",
    "dob",
    "social security",
    "ssn",
    "driver's license",
    "drivers license",
  ];
  for (const d of discovery) {
    if (t.includes(d)) return true;
  }

  return false;
}

function applyDiscoveryCap(state: CallState, lineRaw: string): string {
  if (!state?.context) return String(lineRaw || "");
  const line = String(lineRaw || "").trim();
  if (!line) return getBookingFallbackLine(state.context);

  // Only count discovery questions (not time-window / scheduling questions)
  if (!isDiscoveryQuestionLine(line)) return line;

  const n = Number((state as any).discoveryQuestionCount || 0) + 1;
  (state as any).discoveryQuestionCount = n;

  // Allow 2, force booking on 3+
  if (n > 2) return getBookingFallbackLine(state.context);
  return line;
}


/**
 * ✅ Human waiting / answer gating (NEW)
 * We avoid stepping forward on tiny commits (e.g. "yeah", breath, comfort noise).
 * We do NOT change audio; we only decide whether to respond + whether to advance.
 */
type StepType = "time_question" | "yesno_question" | "open_question" | "statement";

function looksLikeUserQuestion(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;

  // Short confusion/surprise reactions are NOT real questions even if they have "?"
  const rawLower = t;
  const normalized = t.replace(/[^a-z0-9]/g, "");
  const confusionExact = [
    "wait what", "wait, what", "wait what?", "wait, what?",
    "huh", "huh?", "what?", "what??",
    "i m sorry what", "im sorry what", "sorry what",
    "excuse me", "pardon", "come again",
  ];
  const confusionNormalized = ["waitwhat", "huh", "imsorry", "sorryabout"];
  if (confusionExact.includes(rawLower)) return false;
  if (confusionNormalized.some(p => normalized.startsWith(p))) return false;
  if (normalized.length < 10 && normalized.includes("wait") && normalized.includes("what")) return false;

  // Explicit question mark is strongest signal
  if (t.includes("?")) return true;

  // Common spoken-question openers
  if (
    t.startsWith("how ") ||
    t.startsWith("what ") ||
    t.startsWith("why ") ||
    t.startsWith("when ") ||
    t.startsWith("who ") ||
    t.startsWith("where ") ||
    t.startsWith("can you") ||
    t.startsWith("could you") ||
    t.startsWith("do you") ||
    t.startsWith("are you") ||
    t.startsWith("is this") ||
    t.startsWith("is it")
  ) return true;

  // Common question stems even without punctuation
  if (
    t.startsWith("how long") ||
    t.startsWith("how much") ||
    t.startsWith("what happens") ||
    t.startsWith("what do i") ||
    t.startsWith("what do you")
  ) return true;

  return false;
}

function isHowLongDurationQuestion(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;
  const normalized = t.replace(/[?.!,]+$/g, "").replace(/\s+/g, " ").trim();

  return (
    normalized.includes("how long") ||
    normalized.includes("how much time") ||
    normalized.includes("how many minutes") ||
    normalized.includes("is this quick")
  );
}

function hasExplicitLiveTransferIntent(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;
  const normalized = t.replace(/[?.!,]+$/g, "").replace(/\s+/g, " ").trim();
  const wantsAgentNow =
    /\b(speak|talk)\s+(to|with)\s+(him|her|them|the agent|an agent|someone|a person|a real person|your agent|my agent)\b/.test(normalized) ||
    /\b(connect|transfer|put)\s+(me|him|her|them)\b/.test(normalized);
  const nowIntent =
    normalized === "now" ||
    normalized === "right now" ||
    normalized.includes("right now") ||
    normalized.includes("do it now") ||
    normalized.includes("let's do it now") ||
    normalized.includes("let s do it now") ||
    normalized.includes("lets do it now") ||
    normalized.includes("i can do it now") ||
    normalized.includes("i can do now") ||
    normalized.includes("that works now") ||
    normalized.includes("now works") ||
    normalized.includes("available now") ||
    normalized.includes("call now") ||
    normalized.includes("talk now") ||
    normalized.includes("speak now") ||
    normalized.includes("connect now");

  return (
    normalized.includes("connect me") ||
    normalized.includes("transfer me") ||
    normalized.includes("can i talk to him") ||
    normalized.includes("can i speak to the agent") ||
    normalized.includes("put him on") ||
    wantsAgentNow ||
    nowIntent
  );
}

function detectQuestionKindForTurn(textRaw: string): string | null {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return null;

  if (isHowLongDurationQuestion(t)) return "what_entails";

  // If it's clearly a scheduling/availability question, let the existing time ladder handle it.
  try {
    if (isTimeIndecisionOrAvailability(t) || isTimeMentioned(t) || looksLikeTimeAnswer(t)) return null;
  } catch {}

  if (!looksLikeUserQuestion(t)) return null;

  // ✅ Social filler phrases that look like questions but are not real questions
  const fillerPhrases = [
    "what's up", "whats up", "what up", "wassup",
    "yeah what's up", "yeah whats up",
    "what's going on", "whats going on",
    "what's this about", "whats this about",
    "who is this", "who's this", "who's calling",
    "what is this", "what is this about",
  ];
  if (fillerPhrases.some(p => t.includes(p))) return null;

  // "How long / what happens" variants not covered by detectObjection
  if (
    t.includes("what happens") ||
    t.includes("what do i need to do") ||
    t.includes("what do you need") ||
    t.includes("what do you want") ||
    t.includes("what is this for")
  ) return "what_entails";

  return "generic_question";
}


function classifyStepType(lineRaw: string): StepType {
  const line = String(lineRaw || "").toLowerCase();
  if (!line) return "statement";

  const isTime =
    line.includes("later today") ||
    line.includes("today or tomorrow") ||
    line.includes("tomorrow") ||
    line.includes("daytime") ||
    line.includes("evening") ||
    line.includes("morning") ||
    line.includes("afternoon") ||
    line.includes("what time") ||
    line.includes("when would") ||
    line.includes("around that time");

  if (isTime) return "time_question";

  const isQuestion =
    line.includes("?") ||
    line.startsWith("did ") ||
    line.startsWith("do you") ||
    line.startsWith("were you");
  if (!isQuestion) return "statement";

  const looksYesNo =
    line.startsWith("did ") ||
    line.startsWith("do you") ||
    line.startsWith("were you") ||
    line.includes("did you end up") ||
    line.includes("do you remember") ||
    line.includes("can you hear me");

  return looksYesNo ? "yesno_question" : "open_question";
}

// ✅ Exact-time question detector:
// Some time questions are just "today vs tomorrow" or "daytime vs evening" (broad answers OK).
// Others REQUIRE an exact clock time before we can advance (e.g., "what time works best?").
// This prevents "tomorrow afternoon" / "afternoon" from being treated as a final scheduled time.
function isExactTimeQuestion(lineRaw: string): boolean {
  const line = String(lineRaw || "").toLowerCase();
  if (!line) return false;

  // Strong "exact time" signals
  if (line.includes("exact time")) return true;
  if (line.includes("what time")) return true;
  if (line.includes("which time")) return true;
  if (line.includes("at what time")) return true;
  if (line.includes("around what time")) return true;
  if (line.includes("what time works")) return true;
  if (line.includes("what time would")) return true;

  // Also treat "specific time / works best" phrasing as exact-time required.
  // (Your scripts use: "is there a specific time you're available, or what works best for you?")
  if (line.includes("specific time")) return true;
  if (line.includes("time you're available")) return true;
  if (line.includes("time you are available")) return true;
  if (line.includes("what works best")) return true;
  if (line.includes("works best for you")) return true;

  return false;
}


function isDayChoiceQuestion(lineRaw: string): boolean {
  const line = String(lineRaw || "").toLowerCase();
  if (!line) return false;
  return (
    line.includes("later today") ||
    line.includes("today or tomorrow") ||
    line.includes("today vs tomorrow") ||
    (line.includes("would") && line.includes("today") && line.includes("tomorrow"))
  );
}

function pickDayHint(lastUserText: string, priorAccepted: string): "today" | "tomorrow" | null {
  const a = String(lastUserText || "").toLowerCase();
  const b = String(priorAccepted || "").toLowerCase();
  const t = (a + " " + b).trim();

  if (t.includes("today") || t.includes("later today") || t.includes("tonight")) return "today";
  if (t.includes("tomorrow")) return "tomorrow";
  return null;
}


type TimeWindowHint =
  | "morning"
  | "late_morning"
  | "mid_afternoon"
  | "afternoon"
  | "late_afternoon"
  | "evening"
  | "late_evening"
  | "soon_hours"
  | null;

function pickTimeWindowHint(textRaw: string, priorAccepted: string): TimeWindowHint {
  const a = String(textRaw || "").toLowerCase();
  const b = String(priorAccepted || "").toLowerCase();
  const t = (a + " " + b).trim();
  if (!t) return null;

  // Relative time: "in an hour", "in 5 hours", "in 3 hrs"
  // We don't know the user's exact clock/timezone reliably here, so we offer RELATIVE slots.
  if (/\bin\s+an?\s+hour\b/.test(t) || /\bin\s+1\s*(hour|hr|hrs)\b/.test(t)) return "soon_hours";
  if (/\bin\s+\d{1,2}\s*(hours|hour|hr|hrs)\b/.test(t)) return "soon_hours";

  // Windows (prefer more specific)
  if (t.includes("late evening")) return "late_evening";
  if (t.includes("mid afternoon") || t.includes("mid-afternoon")) return "mid_afternoon";
  if (t.includes("late afternoon")) return "late_afternoon";
  if (t.includes("late morning")) return "late_morning";

  if (t.includes("evening") || t.includes("tonight")) return "evening";
  if (t.includes("morning")) return "morning";
  if (t.includes("afternoon")) return "afternoon";

  return null;
}

function extractSoonHours(textRaw: string): number | null {
  const t = String(textRaw || "").toLowerCase();
  if (!t) return null;
  if (/\bin\s+an?\s+hour\b/.test(t)) return 1;

  const m = t.match(/\bin\s+(\d{1,2})\s*(hours|hour|hr|hrs)\b/);
  if (!m) return null;
    const n = Number(m[1] || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  const clamped = Math.max(1, Math.min(12, Math.floor(n)));
  return clamped;
}



function isDayReferenceMentioned(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;
  return /(today|tomorrow|tonight|later today|later|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|weekend|next\s+(?:week|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday))/i.test(t);
}


function isTimeWindowMentioned(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;
  return /(morning|afternoon|evening|tonight|late morning|late afternoon|early evening)/i.test(t);
}

/**
 * ✅ Exact clock-time detector (USED ONLY for allowing book_appointment control).
 * We require an unambiguous time like:
 * - 3pm / 3 pm
 * - 3:30pm / 3:30 pm
 * - 3:30
 * - 3 o'clock
 *
 * We intentionally do NOT treat "tomorrow" / "evening" alone as an exact time.
 */
function isExactClockTimeMentioned(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;

  // 3pm / 3 pm
  if (/\b\d{1,2}\s?(am|pm)\b/i.test(t)) return true;

  // 3:30pm / 3:30 pm
  if (/\b\d{1,2}:\d{2}\s?(am|pm)\b/i.test(t)) return true;

  // 3:30 (still fairly unambiguous)
  if (/\b\d{1,2}:\d{2}\b/.test(t)) return true;

  // 3 o'clock / 3 oclock
  if (/\b\d{1,2}\s?o'?clock\b/i.test(t)) return true;

  // "at 3" / "at 4" / "around 3" / "about 3" — bare hour reference with preposition
  if (/\b(at|around|about|by)\s+\d{1,2}\b/i.test(t)) return true;

  // "3 tomorrow" / "tomorrow at 3" / "3 today" — day + bare hour
  if (/\b\d{1,2}\s+(tomorrow|today|tonight|morning|afternoon|evening)\b/i.test(t)) return true;
  if (/\b(tomorrow|today|tonight|morning|afternoon|evening)\s+(at\s+)?\d{1,2}\b/i.test(t)) return true;

  // 230 / 0230 / 1430 (military-ish compact forms)
  // Accept only when minutes are valid (00-59).
  try {
    const m = t.match(/\b(\d{3,4})\b/);
    if (m) {
      const raw = String(m[1] || "");
      const num = Number(raw);
      if (Number.isFinite(num)) {
        const hh = Math.floor(num / 100);
        const mm = num % 100;
        if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return true;
      }
    }
  } catch {}

  // 2 30 / 14 30 (space-separated)
  if (/\b\d{1,2}\s+\d{2}\b/.test(t)) {
    try {
      const m2 = t.match(/\b(\d{1,2})\s+(\d{2})\b/);
      if (m2) {
        const hh = Number(m2[1] || 0);
        const mm = Number(m2[2] || 0);
        if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return true;
      }
    } catch {}
  }

  // 230pm / 1430 pm
  if (/\b\d{3,4}\s?(am|pm)\b/i.test(t)) return true;

  // Word-number times: "one PM", "two thirty", "three o'clock", "half past two"
  const wordNums: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
  };
  void wordNums;
  const wordTimeRe = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(am|pm|o'?clock|thirty|fifteen|forty.?five)?\b/i;
  if (wordTimeRe.test(t)) {
    // Only match if there's an am/pm or o'clock qualifier, or it's paired with a day reference
    if (/\b(am|pm|o'?clock)\b/i.test(t)) return true;
    if (/\b(tomorrow|today|tonight|morning|afternoon|evening)\b/i.test(t) && wordTimeRe.test(t)) return true;
  }

  return false;
}

function pickOfferedClockTimeFromPrompt(lastPromptLineRaw: string, userTextRaw: string): string | null {
  const lastPromptLine = String(lastPromptLineRaw || "").toLowerCase();
  const userText = String(userTextRaw || "").toLowerCase();
  if (!lastPromptLine || !userText) return null;

  const choosingFirst =
    userText.includes("first") ||
    userText.includes("the first") ||
    userText.includes("earlier") ||
    userText.includes("earliest");
  const choosingSecond =
    userText.includes("second") ||
    userText.includes("the second") ||
    userText.includes("later") ||
    userText.includes("latest");

  // Pull the first two clock-like times from the last prompt line.
  const times: string[] = [];
  const reTime = /\b(\d{1,2}:\d{2}\s?(?:am|pm)?|\d{1,2}\s?(?:am|pm))\b/gi;
  for (const m of lastPromptLineRaw.matchAll(reTime)) {
    const t = String(m[1] || "").trim();
    if (t) times.push(t);
    if (times.length >= 2) break;
  }

  if (choosingFirst || choosingSecond) {
    if (times.length < 2) return null;
    return choosingFirst ? times[0] : times[1];
  }

  // Also match if the user explicitly restates one of the offered times by number or word
  // e.g. "Would one PM work?" when prompt offered "1:00 PM or 1:30 PM"
  const timeMatches = lastPromptLine.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))/gi) || [];
  for (const offered of timeMatches) {
    const offeredHour = offered.match(/\b(\d{1,2})/)?.[1];
    if (!offeredHour) continue;
    const hourNum = parseInt(offeredHour, 10);
    const wordMap: Record<number, string> = {
      1:"one",2:"two",3:"three",4:"four",5:"five",6:"six",
      7:"seven",8:"eight",9:"nine",10:"ten",11:"eleven",12:"twelve"
    };
    const wordVersion = wordMap[hourNum];
    const digitPattern = new RegExp(`\\b${hourNum}\\b`);
    const wordPattern = wordVersion ? new RegExp(`\\b${wordVersion}\\b`, "i") : null;
    if (digitPattern.test(userText) || (wordPattern && wordPattern.test(userText))) {
      return offered.trim();
    }
  }

  return null;
}

function isExactOrOfferedClockTime(stateLastPromptLine: string, userTextRaw: string): boolean {
  if (isExactClockTimeMentioned(userTextRaw)) return true;
  const picked = pickOfferedClockTimeFromPrompt(stateLastPromptLine, userTextRaw);
  return !!picked;
}


function looksLikeTimeAnswer(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;

  // Accept "tomorrow", "afternoon", etc. as a time-answer to a time question (for stepper progression),
  // but do NOT confuse this with an exact time for booking.
  if (isDayReferenceMentioned(t)) return true;
  if (isTimeWindowMentioned(t)) return true;
  if (isExactClockTimeMentioned(t)) return true;

  // ✅ Affirmatives to "later today or tomorrow" = picking today / agreeing to schedule.
  // Treat as a valid time answer so we move forward instead of reprompting.
  const affirmatives = new Set([
    "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "alright",
    "sounds good", "that works", "works for me", "that's fine", "thats fine",
    "fine", "go ahead", "either", "either one", "both work", "whatever",
    "you pick", "your call", "doesn't matter", "doesnt matter",
  ]);
  const stripped = t.replace(/[?.!,]+$/, "").trim();
  if (affirmatives.has(stripped) || affirmatives.has(t)) return true;

  return false;
}

// ✅ Stepper-time detector (broad). DO NOT use for booking control.
function isTimeMentioned(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;
  return isDayReferenceMentioned(t) || isTimeWindowMentioned(t) || isExactClockTimeMentioned(t);
}


// ✅ Confirmation detector (used to allow booking on the confirm step after a prior exact time)
function isAffirmativeConfirmation(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;

  // very common confirmations
  if (
    t === "yes" ||
    t === "yeah" ||
    t === "yep" ||
    t === "yup" ||
    t === "ok" ||
    t === "okay" ||
    t === "sure" ||
    t === "correct" ||
    t === "perfect" ||
    t === "alright" ||
    t === "all right"
  ) return true;

  // short phrases
  if (
    t.includes("that works") ||
    t.includes("works for me") ||
    t.includes("sounds good") ||
    t.includes("that's fine") ||
    t.includes("that’s fine") ||
    t.includes("fine") ||
    t.includes("go ahead")
  ) return true;

  return false;
}

function isFirstTurnContinueReply(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  // Only match pure "what's up" social openers — NOT simple affirmatives like
  // "yeah", "yes", "sure" which are real answers to Step 1 spouse question.
  return (
    [
      "what s up",
      "whats up",
      "yeah what s up",
      "yeah whats up",
      "yes what s up",
      "yes whats up",
    ].includes(t) ||
    /^(yeah|yes|yep|yup|sure|ok|okay|hi|hello)\s+(what s up|whats up)$/.test(t)
  );
}

function isConversationalGreetingContinue(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  if (
    t.includes("not interested") ||
    t.includes("stop calling") ||
    t.includes("wrong number") ||
    t.includes("scam") ||
    t.includes("busy") ||
    t.includes("call me later") ||
    t.includes("tomorrow") ||
    t.includes("right now")
  ) return false;

  // Exact bare matches
  const exactMatches = [
    "yeah", "yep", "yes", "okay", "ok", "sure", "go ahead",
    "what s up", "whats up", "speaking", "this is he", "this is him",
    "this is she", "hello", "hi", "who is this",
    "what is this about", "what can i do for you",
    "yes i can", "yes i can hear you", "yes i can hear",
    "yeah i can", "yeah i can hear you", "yep i can",
    "yep i can hear you", "i can hear you", "i can hear",
    "loud and clear", "loud and clear yes",
  ];

  if (exactMatches.includes(t)) return true;

  // "yes/yeah/yep/ok/sure/hello" followed by anything that isn't a hard exclusion
  if (
    t.startsWith("yes ") ||
    t.startsWith("yeah ") ||
    t.startsWith("yep ") ||
    t.startsWith("yup ") ||
    t.startsWith("ok ") ||
    t.startsWith("okay ") ||
    t.startsWith("sure ") ||
    t.startsWith("hi ") ||
    t.startsWith("hello ")
  ) return true;

  // Regex for combined ack patterns
  if (/^(yeah|yes|yep|yup|ok|okay|sure|hi|hello)\s+(what s up|whats up)$/.test(t)) return true;

  return false;
}

function isStepOneCoverageSubjectAnswer(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  if (["me", "myself", "my self", "just me", "for me", "spouse", "both", "both of us"].includes(t)) return true;
  return (
    /\b(myself|my self|just me|for me|my spouse|spouse|wife|husband|both|both of us|me and my wife|me and my husband|my wife and i|my husband and i)\b/.test(t)
  );
}

function isLiveTransferAvailabilityYes(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  return (
    isAffirmativeConfirmation(t) ||
    t === "now" ||
    t.includes("right now") ||
    t.includes("that works") ||
    t.includes("works now") ||
    t.includes("now works") ||
    t.includes("i can do now") ||
    t.includes("i can do it now") ||
    t.includes("do it now") ||
    t.includes("let s do it now") ||
    t.includes("lets do it now") ||
    t.includes("available now")
  );
}

function hasImmediateTransferConfirmation(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  return (
    t === "now" ||
    t === "right now" ||
    t.includes("right now works") ||
    t.includes("yes right now") ||
    t.includes("yeah right now") ||
    t.includes("sure right now") ||
    t.includes("ok right now") ||
    t.includes("okay right now") ||
    t.includes("now works") ||
    t.includes("now is fine") ||
    t.includes("do it now") ||
    t.includes("let s do it now") ||
    t.includes("lets do it now") ||
    t.includes("i can do it now") ||
    t.includes("i can do now") ||
    t.includes("available now")
  );
}

function hasExplicitAgentTransferCommand(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  return (
    t.includes("transfer me") ||
    t.includes("connect me") ||
    t.includes("put him on") ||
    t.includes("put her on") ||
    t.includes("can i talk to him") ||
    t.includes("can i speak to the agent")
  );
}

function isImmediateTransferSchedulingPreference(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  return (
    t.includes("not right now") ||
    t.includes("not now") ||
    t.includes("can't right now") ||
    t.includes("cannot right now") ||
    t.includes("call me later") ||
    t.includes("call back later") ||
    t.includes("try later") ||
    t.includes("later") ||
    t.includes("tomorrow") ||
    t.includes("today") ||
    t.includes("today later") ||
    t.includes("later today") ||
    t.includes("schedule")
  );
}

function isLiveTransferAvailabilityNo(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  return (
    t === "what do you mean" ||
    t.includes("not now") ||
    t === "later" ||
    t === "later today" ||
    t.includes("later today") ||
    t.includes("later on") ||
    t.includes("this afternoon") ||
    t.includes("this evening") ||
    t.includes("tonight") ||
    t.includes("tomorrow morning") ||
    t.includes("tomorrow afternoon") ||
    t.includes("tomorrow evening") ||
    t.includes("tomorrow night") ||
    t.includes("in a bit") ||
    t.includes("few hours") ||
    t.includes("couple hours") ||
    t.includes("not right now") ||
    t.includes("schedule") ||
    t.includes("set something up") ||
    t.includes("monday") ||
    t.includes("tuesday") ||
    t.includes("wednesday") ||
    t.includes("thursday") ||
    t.includes("friday") ||
    t.includes("saturday") ||
    t.includes("sunday") ||
    t.includes("next week") ||
    t.includes("this week") ||
    t.includes("call back later") ||
    t.includes("try later") ||
    t.includes("later today won't work") ||
    t.includes("not later today") ||
    t.includes("tomorrow") ||
    t.includes("next week") ||
    t.includes("another day") ||
    t.includes("different day") ||
    t === "probably tomorrow" ||
    t.includes("maybe tomorrow") ||
    t.includes("busy") ||
    t.includes("can't right now") ||
    t.includes("cannot right now") ||
    t.includes("don t have time") ||
    t.includes("don't have time") ||
    t.includes("who is") ||
    t.includes("what do you mean") ||
    t.includes("confused")
  );
}

function getAgentFirstName(ctx?: AICallContext): string {
  const raw = String(ctx?.agentName || "").trim();
  return raw ? raw.split(/\s+/)[0] : "the agent";
}

function getLiveTransferAvailabilityLine(ctx?: AICallContext): string {
  return `Got it — I can try to get ${getAgentFirstName(ctx)} on right now if that works, or we can schedule something for later today or tomorrow. What works best for you?`;
}

function getLiveTransferTryingLine(ctx?: AICallContext): string {
  return `Okay, let me try and get ${getAgentFirstName(ctx)} on the line. Give me one second.`;
}


function enforceBookingOnlyLine(ctx: AICallContext, lineRaw: string): string {
  let line = String(lineRaw || "").replace(/\s+/g, " ").trim();
  if (!line) return getBookingFallbackLine(ctx);

  const t = line.toLowerCase();

  // Hard block discovery / underwriting / coverage details
  const banned = [
    "how much is left",
    "how much do you owe",
    "mortgage balance",
    "coverage amount",
    "how much coverage",
    "what coverage",
    "what kind of coverage",
    "what type of coverage",
    "coverage are you looking for",
    "type of coverage",
    "portion of it",
    "are you currently covered",
    "what is your age",
    "how old are you",
    "date of birth",
    "dob",
    "health",
    "medical",
    "smoke",
    "tobacco",
    "medications",
    "height",
    "weight",
    "income",
    "beneficiary",
    "ssn",
    "social security",
    "driver's license",
    "drivers license",
  ];

  for (const b of banned) {
    if (t.includes(b)) return getBookingFallbackLine(ctx);
  }

  // Must remain scheduling-focused (if it drifts, snap back)
  const hasScheduleIntent =
    t.includes("schedule") ||
    t.includes("scheduled") ||
    t.includes("quick call") ||
    t.includes("licensed agent") ||
    t.includes("later today") ||
    t.includes("today or tomorrow") ||
    t.includes("tomorrow") ||
    t.includes("daytime") ||
    t.includes("evening") ||
    t.includes("morning") ||
    t.includes("afternoon") ||
    t.includes("available") ||
    t.includes("what time") ||
    t.includes("what time works") ||
    t.includes("does that work");

  if (!hasScheduleIntent) return getBookingFallbackLine(ctx);

 
 // ALWAYS end with a question to keep the call moving (no dead air, no statements)
 let outLine = line;
 if (!outLine.endsWith("?")) return getBookingFallbackLine(ctx);
 // ✅ Make the agent handoff line sound natural everywhere:
 // Add "Okay," before: "so the next step is to get you with an agent"
 try {
   const lower = outLine.toLowerCase();
   if (
     lower.includes("so the next step is to get you with an agent") &&
     !lower.includes("okay, so the next step is to get you with an agent") &&
     !lower.includes("okay so the next step is to get you with an agent")
   ) {
     outLine = outLine.replace(
       /so the next step is to get you with an agent/i,
       "Okay, so the next step is to get you with an agent"
     );
   }
 } catch {}

 return outLine;
}
function isFillerOnly(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return true;

  // Strip trailing punctuation for matching ("hello." -> "hello")
  const stripped = t.replace(/[?.!,]+$/, "").trim();

  // common tiny acknowledgements / noise
  const fillers = new Set([
    "yeah",
    "yep",
    "yup",
    "uh",
    "uhh",
    "um",
    "umm",
    "mm",
    "mhm",
    "hmm",
    "uh huh",
    "uh-huh",
    "okay",
    "ok",
    // greeting words — these are NOT answers to script questions
    "hello",
    "hi",
    "hey",
    "hey there",
    "hi there",
    "good morning",
    "good afternoon",
    "good evening",
    "can you hear me",
    "yeah i can hear you",
    "i can hear you",
    "yes i can hear you",
    "yes i can",
    "loud and clear",
  ]);

  if (fillers.has(t) || fillers.has(stripped)) return true;

  // Regex catch for stretched fillers: "uhhh", "ummm", "hmmmm", etc.
  if (/^(uh+|um+|mm+|mhm+|hmm+|er+|ah+|eh+)$/.test(stripped)) return true;

  // greeting-only sentences (1–3 words, all greeting tokens)
  const greetingTokens = new Set(["hello","hi","hey","there","good","morning","afternoon","evening","howdy","yo"]);
  const words = stripped.split(/\s+/);
  if (words.length <= 3 && words.every(w => greetingTokens.has(w))) return true;

  // IMPORTANT:
  // Do NOT treat every 1-word reply as filler.
  // Words like "probably", "both", "tomorrow", "evening", "yes" can be meaningful depending on step type.
  return false;
}


function isTimeIndecisionOrAvailability(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;

  // Questions about our availability
  if (
    t.includes("what do you have") ||
    t.includes("what times do you have") ||
    t.includes("what time do you have") ||
    t.includes("what are your times") ||
    t.includes("what's available") ||
    t.includes("whats available") ||
    t.includes("what do you guys have") ||
    t.includes("what do yall have") ||
    t.includes("any openings") ||
    t.includes("any slots") ||
    t.includes("available tomorrow") ||
    t.includes("tomorrow available")
  ) return true;

  // Indecision / "you pick"
  if (
    t.includes("you pick") ||
    t.includes("you choose") ||
    t.includes("doesn't matter") ||
    t.includes("doesnt matter") ||
    t.includes("either one") ||
    t.includes("either is fine") ||
    t.includes("whatever works") ||
    t.includes("anytime") ||
    t.includes("whenever") ||
    t.includes("i'm flexible") ||
    t.includes("im flexible")
  ) return true;

  // "Later" / "after" style answers (these ARE real answers to time questions)
  // Examples: "something later", "a little later", "later on", "after that"
  if (
    t == "later" ||
    t.startsWith("later ") ||
    t.endsWith(" later") ||
    t.includes("something later") ||
    t.includes("a little later") ||
    t.includes("little later") ||
    t.includes("later on") ||
    t.includes("later today") ||
    t.includes("later this") ||
    t.includes("after that") ||
    t.includes("afterwards") ||
    t.includes("after work")
  ) return true;

  // Generic "not sure" answers to time questions
  if (
    t == "not sure" ||
    t.startsWith("not sure") ||
    t.includes("not sure") ||
    t.includes("not certain") ||
    t.includes("i don't know") ||
    t.includes("idk")
  ) return true;

  return false;
}

function getTimeOfferLine(
  ctx: AICallContext,
  n: number,
  dayHint: string | null,
  windowHint: TimeWindowHint,
  rawUserText: string
): string {
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";

  const isNamedDay = !!dayHint && dayHint !== "today" && dayHint !== "tomorrow";
  const day = dayHint === "today" ? "later today"
    : dayHint === "tomorrow" ? "tomorrow"
    : isNamedDay ? (String(dayHint).charAt(0).toUpperCase() + String(dayHint).slice(1))
    : "tomorrow";

  // If they asked relative ("in X hours"), offer relative slots (we can't trust server timezone).
  if (windowHint === "soon_hours") {
    const h = extractSoonHours(rawUserText) || 1;
    const h2 = Math.min(12, h + 1);
    return `Got it — I have about ${h} hour${h === 1 ? "" : "s"} from now or about ${h2} hours from now available. Which works better?`;
  }

  // Concrete clock-time slots by window (these are "offer options", not confirming a final booking yet).
  // Keep it human, always end with a question.
  //
  // ✅ IMPORTANT:
  // We MUST NOT offer the same exact times to everyone.
  // So we vary the offered pair deterministically per lead/session/day/window/rung (stable within a call).
  function stableHash32(input: string): number {
    const str = String(input || "");
    let h = 2166136261; // FNV-1a 32-bit
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }

  
  // ✅ Dynamic slots (no hardcoded time lists)
  // We generate clock-time options from broad windows using ranges + interval.
  // This avoids offering the same exact times to everyone while still sounding natural.
  function pad2(n: number): string { return String(n).padStart(2, "0"); }

  function minutesToLabel(totalMins: number): string {
    const m = Math.max(0, Math.min(24*60-1, Math.floor(totalMins)));
    let hh = Math.floor(m / 60);
    const mm = m % 60;
    const isPm = hh >= 12;
    let h12 = hh % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${pad2(mm)}${isPm ? "pm" : "am"}`;
  }

  function buildSlots(startMins: number, endMinsInclusive: number, stepMins: number): string[] {
    const out: string[] = [];
    const step = Math.max(5, Math.min(60, Math.floor(stepMins || 30)));
    let t = Math.max(0, Math.floor(startMins));
    const end = Math.min(24*60-1, Math.floor(endMinsInclusive));
    while (t <= end) {
      out.push(minutesToLabel(t));
      t += step;
    }
    return out;
  }

  type WindowRange = { start: number; end: number; step: number };

  // Window ranges (minutes since midnight). Keep these broad and human.
  const ranges: Record<string, WindowRange> = {
    morning:        { start: 8*60,     end: 11*60+30, step: 30 },
    late_morning:   { start: 10*60,    end: 12*60,    step: 30 },
    afternoon:      { start: 12*60,    end: 16*60+30, step: 30 },
    mid_afternoon:  { start: 13*60+30, end: 16*60,    step: 30 },
    late_afternoon: { start: 15*60+30, end: 18*60,    step: 30 },
    evening:        { start: 17*60,    end: 20*60+30, step: 30 },
    late_evening:   { start: 19*60,    end: 21*60+30, step: 30 },
  };

  function getSlotsForWindow(win: string, isToday: boolean): string[] {
    const key = String(win || "").trim();
    const r = (ranges as any)[key] as WindowRange | undefined;
    if (r) return buildSlots(r.start, r.end, r.step);
    // fallback by day
    const fallback = isToday ? ranges["evening"] : ranges["afternoon"];
    return buildSlots(fallback.start, fallback.end, fallback.step);
  }


// Default window if none provided: today→evening, tomorrow→afternoon
  const isToday = dayHint === "today";
  const defaultWindow: TimeWindowHint = isToday ? "evening" : "afternoon";
  const w: TimeWindowHint = windowHint || defaultWindow;

    const list = getSlotsForWindow(String(w), isToday);

  // ✅ TODAY SAFETY: never offer past times for "today".
  // Filter "today" slots to future-only based on a reliable timezone:
  // lead tz hint > agent tz > America/Phoenix.
  let listToUse = list;
  let dayLabel = day;

  function getNowMinutesInTz(tz: string): number | null {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(new Date());
      const hh = Number(parts.find((p: any) => p.type === "hour")?.value || "");
      const mm = Number(parts.find((p: any) => p.type === "minute")?.value || "");
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
      return Math.max(0, Math.min(24 * 60 - 1, hh * 60 + mm));
    } catch {
      return null;
    }
  }

  // Parse labels like "1:30pm" into minutes since midnight.
  function labelToMinutes(lbl: string): number | null {
    const t = String(lbl || "").trim().toLowerCase();
    const m = t.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
    if (!m) return null;
    let hh = Number(m[1] || 0);
    const mm = Number(m[2] || 0);
    const ap = String(m[3] || "");
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 1 || hh > 12) return null;
    if (mm < 0 || mm > 59) return null;

    // convert to 24h
    if (ap === "am") {
      if (hh === 12) hh = 0;
    } else if (ap === "pm") {
      if (hh !== 12) hh = hh + 12;
    } else {
      return null;
    }
    return hh * 60 + mm;
  }

  // Choose timezone: lead tz hint > agent tz > America/New_York
  let tz = "";
  try { tz = String(getLeadTimeZoneHintFromContext(ctx as any) || "").trim(); } catch {}
  const ctxAgentTz = String((ctx as any)?.agentTimeZone || "").trim();
  if (!tz || !isValidIanaTimeZone(tz)) {
    if (isValidIanaTimeZone(ctxAgentTz)) tz = ctxAgentTz;
    else tz = "America/New_York";
  }

  if (isToday) {
    const nowM = getNowMinutesInTz(tz);
    if (nowM != null) {
      const cutoff = nowM + 30; // require at least +30 minutes
      const cutoffRounded = Math.min(24 * 60 - 1, Math.ceil(cutoff / 30) * 30); // round to 30-min boundary
      try {
        listToUse = (list || []).filter((x: any) => {
          const xm = labelToMinutes(String(x || ""));
          return xm != null && xm >= cutoffRounded;
        });
      } catch {}
    }

    // If no valid "today" slots remain, fall back to tomorrow.
    if (!Array.isArray(listToUse) || listToUse.length < 2) {
      dayLabel = "tomorrow";
      const isToday2 = false;
      const defaultWindow2: any = "afternoon";
      const w2: any = windowHint || defaultWindow2;
      listToUse = getSlotsForWindow(String(w2), isToday2);
    }
  }


  // Seed: best-effort stable identifiers + day/window + rung
  const seed = [
    String((ctx as any)?.leadId || ""),
    String((ctx as any)?.sessionId || ""),
    String((ctx as any)?.callSid || ""),
    String((ctx as any)?.clientPhone || (ctx as any)?.phone || ""),
    String((ctx as any)?.userEmail || ""),
    String(ctx.clientFirstName || ""),
    String(agentRaw || ""),
    String(dayHint || ""),
    String(windowHint || ""),
    String(n || 0),
  ].join("|");

  const hv = stableHash32(seed);

  // Pick an adjacent pair (chronological) so it sounds natural.
  let a = "1:30pm";
  let b = "3:00pm";
  try {
    if (Array.isArray(listToUse) && listToUse.length >= 2) {
      const ut = String(rawUserText || "").toLowerCase();
      const wantsEarlier =
        ut.includes("earlier") || ut.includes("sooner") || ut.includes("before");
      const wantsLater =
        ut.includes("later") || ut.includes("later today") || ut.includes("later on") || ut.includes("after");

      // Prefer 90-min gap (3 × 30-min slots), fallback 60 min (2 slots), absolute min 1 slot.
      // Never offer adjacent 30-min slots (e.g. 1:00 and 1:30).
      const _gapPref = 3;
      const _gapFb = 2;
      const i =
        wantsEarlier ? 0 :
        wantsLater   ? Math.max(0, listToUse.length - 1 - _gapPref) :
        (listToUse.length > _gapPref ? (hv % Math.max(1, listToUse.length - _gapPref)) : 0);
      a = (listToUse as any)[i] || a;
      let _bIdx = i + _gapPref;
      if (_bIdx >= listToUse.length) _bIdx = i + _gapFb;
      if (_bIdx >= listToUse.length) _bIdx = i + 1;
      if (_bIdx >= listToUse.length) _bIdx = listToUse.length - 1;
      b = (listToUse as any)[_bIdx] || b;
    }
  } catch {}

  const utLock = String(rawUserText || "").toLowerCase();
  const wantsLaterLock = utLock.includes("later") || utLock.includes("latest") || utLock.includes("after");
  const lock = wantsLaterLock ? b : a;
  if (n >= 2) return `Got it — ${dayLabel} I have ${lock} available. Does that work?`;
  return `Got it — ${dayLabel} I have ${a} or ${b} available. Which works better?`;
}

function shouldTreatCommitAsRealAnswer(
  stepType: StepType,
  audioMs: number,
  transcript: string
): boolean {
  const text = String(transcript || "").trim();

  // If we have transcription:
  if (text) {
    // Time questions: allow explicit time answers + affirmatives ("yeah" = today)
    if (stepType === "time_question") {
      return looksLikeTimeAnswer(text) || isTimeIndecisionOrAvailability(text);
    }

    // open_question / yesno_question: advance on any non-filler.
    // If the answer didn't actually address the question, the free-response branch
    // will handle it naturally — GPT re-asks conversationally rather than looping
    // on a canned reprompt line.
    if (isFillerOnly(text)) return false;
    return true;
  }

  /**
   * ✅ Patch (critical):
   * No transcription available → do NOT advance booking steps that require semantic understanding.
   * If we don't know what they said, we cannot detect objections like "already taken care of",
   * so advancing here causes loops/repeats.
   *
   * Rule:
   * - time_question + open_question require text (transcript) to count as a real answer.
   * - yes/no can still be inferred from audio length if needed.
   */
  if (stepType === "time_question") return false;
  if (stepType === "open_question") return false;
  if (stepType === "yesno_question") return audioMs >= 1200;
  return audioMs >= 1400;
}


function getRepromptLineForStepType(
  ctx: AICallContext,
  stepType: StepType,
  n: number
): string {
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();

  if (stepType === "time_question") {
    const ladder = [
      `Totally — would later today or tomorrow be better?`,
      `What’s easier for you — today or tomorrow?`,
      `No worries — I can put you down for a quick call with ${agent}. Is today or tomorrow better?`,
    ];
    return ladder[Math.min(n, ladder.length - 1)];
  }

  if (stepType === "yesno_question") {
    const ladder = [
      `Got you — would that be a yes, or a no?`,
      `Just so I’m clear — is that something you already have in place?`,
      `No worries — to keep it simple: yes or no? If it’s easier, we can just schedule and ${agent} will cover everything. Would later today or tomorrow be better?`,
    ];
    return ladder[Math.min(n, ladder.length - 1)];
  }

  if (stepType === "open_question") {
    // open_question reprompts always use the free-response GPT path.
    // Return the booking fallback as a backstop — the useFreeResponse check
    // in the committed handler will override this with a GPT-generated response
    // that re-asks the question naturally based on context.
    return getBookingFallbackLine(ctx);
  }

  return getBookingFallbackLine(ctx);
}

function detectObjection(textRaw: string): string | null {
  const t = String(textRaw || "").trim().toLowerCase();

  // "Are you an AI / robot?" — explicit identity questions only; broad (ai && ?) removed to avoid
  // capturing product questions like "Does CoveCRM use AI?" or "How does the AI work?"
  if (
    t.includes("are you ai") ||
    t.includes("are you an ai") ||
    t.includes("are you a robot") ||
    t.includes("are you real") ||
    t.includes("is this ai") ||
    t.includes("is this a robot") ||
    t.includes("is it a robot") ||
    t.includes("am i talking to a robot") ||
    t.includes("am i talking to an ai")
  ) return "are_you_ai";

  // "What does this call entail / how long?" — checked BEFORE confused_identity so that
  // "what is this about" does not get swallowed by the "what is this" substring in confused_identity.
  if (
    t.includes("what does this entail") ||
    t.includes("what is this about") ||
    t.includes("what is this call about") ||
    t.includes("what is this for") ||
    t.includes("what is it about") ||
    t.includes("how does this work") ||
    t.includes("how long does it take") ||
    t.includes("how long will it take") ||
    t.includes("what happens on the call") ||
    t.includes("what do you cover") ||
    t.includes("what do we talk about") ||
    t.includes("what are we going over")
  ) return "what_entails";

  // Confusion / identity / "what is this"
  if (
    t.includes("who are you") ||
    t.includes("who is this") ||
    t.includes("what is this") ||
    t.includes("im confused") ||
    t.includes("i'm confused") ||
    (t.includes("confused") && (t.includes("who") || t.includes("why") || t.includes("what"))) ||
    t.includes("why are you calling") ||
    t.includes("when did i") && (t.includes("request") || t.includes("fill") || t.includes("sign")) ||
    t.includes("i dont remember") ||
    t.includes("i don't remember") ||
    t.includes("dont remember") ||
    t.includes("don't remember") ||
    t.includes("doesn't ring a bell") ||
    t.includes("doesnt ring a bell")
  ) return "confused_identity";
  if (!t) return null;

  // "I don't need it anymore" / "don't think I need this" -> treat as not interested (booking-only rebuttal)
  if (
    t.includes("dont need it") ||
    t.includes("don't need it") ||
    t.includes("dont need this") ||
    t.includes("don't need this") ||
    t.includes("dont think i need") ||
    t.includes("don't think i need") ||
    t.includes("not sure i need") ||
    t.includes("need it anymore") ||
    t.includes("dont need it anymore") ||
    t.includes("don't need it anymore")
  ) {
    // If they are actively scheduling, don't derail into rebuttal.
    try {
      if (isTimeIndecisionOrAvailability(t) || isTimeMentioned(t)) return null;
    } catch {}
    return "not_interested";
  }

  // Very lightweight; only triggers if we actually have a transcript.
  // We NEVER follow them into other verticals; we keep booking-only language.

  // We NEVER follow them into other verticals; we keep booking-only language.
  if (
    t.includes("not interested") ||
    t.includes("stop calling") ||
    t.includes("remove") ||
    t.includes("do not call") ||
    t === "nah" ||
    t === "nope" ||
    t === "not really" ||
    t === "i m good" ||
    t === "im good" ||
    t === "i m all good" ||
    t === "im all good" ||
    t === "i m fine" ||
    t === "im fine" ||
    t === "not interested" ||
    t.startsWith("nah ") ||
    t.startsWith("not really") ||
    (t.includes("good") && t.includes("i m") && t.length < 20) ||
    (t.includes("fine") && t.length < 15)
  ) {
    return "not_interested";
  }
  if (t.includes("scam") || t.includes("fraud") || t.includes("spam")) {
    return "scam";
  }
  if (
    t.includes("already have") ||
    t.includes("already have it") ||
    t.includes("got coverage") ||
    t.includes("i have coverage") ||
    t.includes("im covered") ||
    t.includes("i'm covered") ||
    t.includes("covered already") ||

    // "already taken care of" variants (common real speech)
    t.includes("taken care of") ||
    t.includes("already taken care of") ||
    t.includes("it's taken care of") ||
    t.includes("its taken care of") ||
    t.includes("been taken care of") ||
    t.includes("i took care of") ||
    t.includes("i already took care") ||
    t.includes("took care of it") ||

    // "handled it" variants
    t.includes("already handled") ||
    t.includes("i handled it") ||
    t.includes("i already handled") ||
    t.includes("handled it already") ||
    t.includes("got it handled") ||
    t.includes("already got it") ||

    // short closers
    t.includes("all set") ||
    t.includes("i'm all set") ||
    t.includes("im all set")
  ) {
      // If they are still actively scheduling (e.g. "what times do you have tomorrow"),
  // don't treat this as an objection — let the stepper offer time options.
  try {
    if (isTimeIndecisionOrAvailability(t) || isTimeMentioned(t)) return null;
  } catch {}
  return "already_have";
}
if (
    t.includes("busy") ||
    t.includes("at work") ||
    t.includes("no time") ||
    t.includes("dont have time") ||
    t.includes("don't have time") ||
    t.includes("do not have time") ||
    t.includes("not much time") ||
    t.includes("not a good time") ||
    t.includes("bad time") ||
    t.includes("can't talk") ||
    t.includes("cant talk") ||
    t.includes("in a meeting") ||
    t.includes("kind of busy") ||
    t.includes("kinda busy") ||
    t.includes("really busy") ||
    /don.?t.*have.*time/i.test(t) ||
    t.includes("pressed for time") ||
    t.includes("short on time") ||
    t.includes("in the middle of") ||
    /not\s+(?:a\s+)?good\s+time/i.test(t) ||
    /(?:really|very|too)\s+busy/i.test(t) ||
    /can.?t\s+(?:really\s+)?talk\s+(?:right\s+)?now/i.test(t)
  ) {
    // If they are still actively scheduling (e.g. "tomorrow evening" / "what times do you have"),
    // do NOT treat this as an objection — let the stepper offer concrete time options.
    try {
      if (isTimeIndecisionOrAvailability(t) || isTimeMentioned(t)) return null;
    } catch {}
    return "busy";
  }
  // "Already talked to someone / already spoke with agent"
  if (
    t.includes("already talked") ||
    t.includes("already spoke") ||
    t.includes("already spoken") ||
    t.includes("already called") ||
    t.includes("someone already called") ||
    t.includes("talked to someone") ||
    t.includes("spoke with someone") ||
    t.includes("spoke with") && t.includes("agent") ||
    t.includes("talked to") && t.includes("agent") ||
    t.includes("already set up") ||
    t.includes("already scheduled") ||
    t.includes("already booked")
  ) return "already_talked";

  // "How did you get my number / information"
  if (
    t.includes("how did you get my") ||
    t.includes("where did you get my") ||
    t.includes("how do you have my") ||
    t.includes("where did you find my") ||
    t.includes("who gave you my") ||
    t.includes("how'd you get my")
  ) return "how_did_you_get";

  // "Can you mail it / send it in the mail / text it over"
  if (t.includes("text me") || t.includes("send it") || t.includes("email me") ||
      t.includes("mail it") || t.includes("send me") || t.includes("text it") ||
      t.includes("send that over") || t.includes("send over") || t.includes("mail me")) {
    // If they are still actively scheduling ("text me the times you have tomorrow"),
    // keep booking flow and offer options instead of rebuttal.
    try {
      if (isTimeIndecisionOrAvailability(t) || isTimeMentioned(t)) return null;
    } catch {}
    return "send_it";
  }
  if (t.includes("how much") || t.includes("price") || t.includes("cost")) {
    // If they're still scheduling ("how much — tomorrow evening works"),
    // don't derail booking; offer times and keep it moving.
    try {
      if (isTimeIndecisionOrAvailability(t) || isTimeMentioned(t)) return null;
    } catch {}
    return "how_much";
  }
  if (
    t.includes("don't remember") ||
    t.includes("do not remember") ||
    t.includes("never filled") ||
    t.includes("didn't fill") ||
    t.includes("who is this")
  ) {
    return "dont_remember";
  }

  // If they mention disallowed topics, treat it as a "redirect" objection.
  if (
    t.includes("vacation") ||
    t.includes("resort") ||
    t.includes("timeshare") ||
    t.includes("energy") ||
    t.includes("utility") ||
    t.includes("medicare") ||
    t.includes("health") ||
    t.includes("aca") ||
    t.includes("obamacare") ||
    t.includes("real estate") ||
    t.includes("loan")
  ) {
    return "redirect";
  }

  return null;
}

function getRebuttalLine(ctx: AICallContext, kind: string): string {
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();

  if (kind === "not_interested") {
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    const lines = [
      `I completely understand — and I'm not here to pressure you at all. A lot of people feel that way before they see what's actually available for their situation. ${agent}'s call is literally just 5 minutes, no obligation. Does later today or tomorrow work better?`,
      `Yeah, totally fair. I hear you. The thing is, ${agent} just wants to make sure the ${scope} request didn't fall through the cracks — it's a free 5-minute call, nothing more. Does later today or tomorrow work better?`,
      `That makes total sense, and I respect that. I'll just say — most people who felt that way ended up really glad they took the 5 minutes. ${agent} keeps it quick and simple. Does later today or tomorrow work better?`,
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  if (kind === "already_have") {
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    return `I completely understand — and that's actually great that you have something in place. A lot of people ${agent} works with have coverage but end up overpaying or have gaps they didn't know about. The call is literally just to make sure what you have still makes sense. Does later today or tomorrow work better?`;
  }

  if (kind === "busy") {
    return `I completely understand — and I won't keep you long. ${agent}'s call is only about 5 minutes at whatever time works for you. Does later today or tomorrow work better?`;
  }

  if (kind === "how_much") {
    return `Yeah totally — and that's actually the main thing ${agent} covers on the call, because it really depends on your specific situation. The call is free and only takes about 5 minutes. Does later today or tomorrow work better?`;
  }

  if (kind === "send_it") {
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    return `I completely understand — and honestly the ${scope} stuff is a lot easier to explain on a quick call than over text. ${agent} keeps it to 5 minutes and makes it real simple. Does later today or tomorrow work better?`;
  }

  if (kind === "scam") {
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    if (normalizeScriptKey(ctx.scriptKey) === "kayla_signup") {
      return `Totally fair to ask. This is CoveCRM's AI — this call is the demo. Nothing to buy right now, I just want to make sure you got a real sense of how it works. Want me to text you the signup link?`;
    }
    return `I completely understand the concern — and that's a fair reaction. This is just a scheduling call for the ${scope} request that came through. ${agent} is a licensed agent and everything is explained on the call. Does later today or tomorrow work better?`;
  }

  if (kind === "dont_remember") {
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    return `Yeah, totally — it may have been a little while since the request came through. This is just regarding ${scope} — ${agent} just wants to make sure you got taken care of. Does later today or tomorrow work better?`;
  }

  if (kind === "already_talked") {
    return `Got it — and that's totally fine. This is just the follow-up to make sure everything got wrapped up on your end. ${agent} keeps it quick. Does later today or tomorrow work better?`;
  }

  if (kind === "how_did_you_get") {
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    return `Yeah, fair question — the information came through a form that was submitted online for ${scope}. ${agent} just wants to make sure you're taken care of. Does later today or tomorrow work better?`;
  }

  if (kind === "are_you_ai") {
    const aiName = (ctx.voiceProfile?.aiName || "Alex").trim() || "Alex";
    if (normalizeScriptKey(ctx.scriptKey) === "kayla_signup") {
      return `Yes — and that’s exactly the point. What you’re hearing right now is what your leads would hear. This is the CoveCRM AI running live. What else can I answer for you?`;
    }
    return `Yes — I’m a virtual assistant helping the agents with scheduling. The licensed agent handles the actual appointment. ${agent} is the licensed agent who handles everything on the actual call. Does later today or tomorrow work better?`;
  }

  if (kind === "confused_identity") {
    const aiName = (ctx.voiceProfile?.aiName || "Alex").trim() || "Alex";
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    return `Good question — my name is ${aiName}, I'm a scheduling assistant calling on behalf of ${agent}. This is regarding the ${scope} request that came through — ${agent} just wants a quick 5-minute call to go over everything. Does later today or tomorrow work better?`;
  }

  if (kind === "what_entails") {
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    if (normalizeScriptKey(ctx.scriptKey) === "kayla_signup") {
      return `Sure — CoveCRM's AI calls through your lead list, handles objections like this one, and either books appointments directly or hands off warm leads to you live. There's also automated SMS follow-up and call scoring built in. Which part would be most useful for your setup?`;
    }
    const lines = [
      `So it's really quick — usually 5 to 10 minutes. ${agent} just goes over the ${scope} request, answers any questions you have, and makes sure everything makes sense for your situation. No pressure at all. Does later today or tomorrow work better?`,
      `Yeah it's short — ${agent} keeps it to about 5 minutes. Just goes over the ${scope} request and answers your questions. That's really it. Does later today or tomorrow work better?`,
      `Honestly it's pretty painless — ${agent} just covers the ${scope} request, answers whatever you want to know, and that's it. Usually 5 to 10 minutes max. Does later today or tomorrow work better?`,
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  if (kind === "generic_question") {
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    if (normalizeScriptKey(ctx.scriptKey) === "kayla_signup") {
      const lines = [
        `I want to make sure I answer this clearly — what specifically is on your mind? Pricing, how the dialer works, the Facebook lead flow, something else?`,
        `Fair enough. What exactly would help? I can break down pricing, the AI dialer, the lead integrations, the call coaching — whatever's most relevant to your situation.`,
        `Good question. What part would be most useful to dig into — how the AI handles calls, the cost, how leads come in, or something else?`,
      ];
      return lines[Math.floor(Math.random() * lines.length)];
    }
    const lines = [
      `I completely understand. That's a fair question. ${agent} can answer that much better on the quick call and make it specific to your ${scope} request. Does later today or tomorrow work better?`,
      `Yeah, totally. I hear what you're asking. ${agent} covers that on the call so you get a clear answer for your situation, and it only takes about 5 minutes. Does later today or tomorrow work better?`,
      `That makes sense. I get why you'd ask. ${agent} is the one who goes over that part on the quick call and keeps it simple. Does later today or tomorrow work better?`,
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  if (kind === "redirect") {
    return getBookingFallbackLine(ctx);
  }

  return getBookingFallbackLine(ctx);
}

function buildDeterministicScamRebuttalLine(state: CallState): string {
  const ctx = state.context!;
  const k = normalizeScriptKey(ctx.scriptKey);
  const firstName = (ctx.clientFirstName || "").trim() || "there";
  const agentFirst = ((ctx.agentName || "").split(/\s+/)[0] || "the agent").trim();

  if (k === "kayla_signup") {
    return `Totally fair question, ${firstName} — what you're hearing right now is actually the CoveCRM AI. This is the demo. I'm not a sales person reading a script — I'm the product. ${agentFirst} can answer any specific questions on a quick call. Want to grab a time?`;
  }

  let requestScope = "insurance request";
  if (k.startsWith("veteran")) {
    requestScope = "veteran life insurance request";
  } else if (k.startsWith("trucker")) {
    requestScope = "life insurance for truckers request";
  } else if (k === "mortgage_protection") {
    requestScope = "mortgage protection request";
  } else if (k === "final_expense") {
    requestScope = "final expense request";
  } else if (k === "iul_cash_value") {
    requestScope = "IUL request";
  }

  const selectedTime = String((state as any).lastExactTimeText || "").trim();
  const selectedDay = String(state.selectedDay || "").trim().toLowerCase();

  let nextStepLine: string;
  if (selectedTime) {
    nextStepLine = `Does ${selectedTime} still work for you?`;
  } else if (selectedDay === "today" || selectedDay === "tomorrow") {
    nextStepLine = getTimeOfferLine(ctx, 0, selectedDay, null, "");
  } else if (selectedDay) {
    nextStepLine = getTimeOfferLine(ctx, 0, selectedDay, null, "");
  } else {
    nextStepLine = "Does later today or tomorrow work better?";
  }

  return `I completely understand the concern, ${firstName}. This is a state-regulated ${requestScope}, and ${agentFirst} is licensed through the state. Everything is explained clearly on the call through licensed carriers. ${nextStepLine}`;
}

function getStateAwareClosingPivot(state: CallState): string {
  try {
    if (normalizeScriptKey(state.context?.scriptKey) === "kayla_signup") return "";
    const selectedTime = String((state as any).lastExactTimeText || "").trim();
    const selectedDay = String(state.selectedDay || "").trim().toLowerCase();
    if (selectedTime) {
      return `Does ${selectedTime} still work for you?`;
    }
    if (selectedDay && state.context) {
      return getTimeOfferLine(state.context, 0, selectedDay, null, "");
    }
  } catch {}
  return "Does later today or tomorrow work better?";
}

/**
 * Returns the canonical close question for the current script type.
 * Used in GPT instruction builders so the AI closes with a line that fits the script —
 * insurance appointment, live-transfer, or Kayla demo/signup.
 */
function getScriptCloseQuestion(ctx: AICallContext): string {
  const k = normalizeScriptKey(ctx?.scriptKey);
  const agentRaw = (ctx?.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim() || agentRaw;
  const liveTransferEnabled = !!(ctx as any)?.liveTransferEnabled && !!(ctx as any)?.liveTransferPhone;

  if (k === "kayla_signup") {
    return liveTransferEnabled
      ? `Does right now work for a quick demo with ${agent}, or would later today or tomorrow be better?`
      : `Would later today or tomorrow work for a quick demo with ${agent}?`;
  }

  // All insurance verticals (appointment or transfer)
  return liveTransferEnabled
    ? `Does right now work for a quick call with ${agent}, or would later today or tomorrow be better?`
    : `Would later today or tomorrow work better for a quick call with ${agent}?`;
}

// ── Conversation Policy Layer ──────────────────────────────────────────────────

type TurnIntentKind =
  | "greeting_ack"
  | "hearing_problem"
  | "coverage_subject_answer"
  | "day_selection"
  | "time_window"
  | "exact_time"
  | "scheduling_preference"
  | "live_transfer_now"
  | "live_transfer_later"
  | "objection"
  | "question"
  | "angry_or_profane"
  | "confusion"
  | "not_interested"
  | "off_topic"
  | "unknown"
  | "script_advance"
  | "reprompt_step";

interface TurnIntent {
  kind: TurnIntentKind;
  subKind?: string | null;
  raw: string;
}

type ResponseMode = "exact_script" | "soft_script" | "guided_gpt" | "free_response" | "free_response_blocked" | "script_step";

interface PolicyDecision {
  handled: boolean;
  routeKind: string;
  responseMode: ResponseMode;
  objective: string;
  lineToSay?: string;
  baseAnswer?: string;
  userText?: string;
  requiredClosingPivot: string;
  forbiddenTopics: string[];
  stateWrites: Record<string, unknown>;
  shouldAdvanceStep: boolean;
  repeatMode?: boolean;
}

function isPostCoverageSchedulingState(state: CallState): boolean {
  const routeKind = String(state.lastRouteKind || "");
  const selectedDay = String(state.selectedDay || "").trim().toLowerCase();
  return (
    !!state.pendingLiveTransferAvailabilityConfirm ||
    routeKind === "policy_step1_coverage" ||
    routeKind.startsWith("policy_step1_coverage_") ||
    routeKind === "policy_live_transfer_try" ||
    routeKind === "policy_live_transfer_later" ||
    routeKind === "policy_day_selected" ||
    routeKind === "policy_time_window" ||
    routeKind === "policy_none_work" ||
    routeKind === "policy_exact_time" ||
    routeKind === "policy_unknown" ||
    routeKind.startsWith("post_coverage_") ||
    ((selectedDay === "today" || selectedDay === "tomorrow") && Number(state.scriptStepIndex || 0) >= 1)
  );
}

function logPostCoverageLegacySuppress(
  state: CallState,
  source: "main" | "replay",
  routeName: string,
  lastUserText: string
): void {
  try {
    console.log("[AI-VOICE][POST-COVERAGE-GUARD] legacy route suppressed", {
      callSid: state.callSid,
      source,
      routeName,
      userTextHash: hash8(lastUserText),
      lastRouteKind: state.lastRouteKind || null,
      selectedDay: state.selectedDay || null,
      selectedWindow: state.selectedWindow || null,
      selectedTimeText: state.selectedTimeText ? "[set]" : null,
      scriptStepIndex: state.scriptStepIndex,
      awaitingAnswerForStepIndex: state.awaitingAnswerForStepIndex,
      pendingLiveTransferAvailabilityConfirm: !!state.pendingLiveTransferAvailabilityConfirm,
    });
  } catch {}
}

function buildPostCoverageTimeOfferDecision(
  state: CallState,
  intent: TurnIntent,
  ctx: AICallContext,
  stepCtx: { idx: number; steps: string[]; stepType: StepType },
  routeKind: string,
  routeReason: string
): PolicyDecision {
  const explicitDay = pickDayHint(intent.raw, "");
  const namedDay: string | null = (intent.subKind && intent.subKind !== "today" && intent.subKind !== "tomorrow")
    ? intent.subKind
    : extractNamedWeekday(intent.raw.toLowerCase());
  const rememberedDay = String(state.selectedDay || "").trim().toLowerCase();
  const rememberedNamedDay = rememberedDay && rememberedDay !== "today" && rememberedDay !== "tomorrow" ? rememberedDay : null;
  const dayHint: string | null =
    explicitDay === "today" || explicitDay === "tomorrow"
      ? explicitDay
      : rememberedDay === "today" || rememberedDay === "tomorrow"
        ? rememberedDay
        : namedDay || rememberedNamedDay
          || pickDayHint(intent.raw, String(state.lastAcceptedUserText || ""));
  const windowHint = pickTimeWindowHint(intent.raw, String(state.lastAcceptedUserText || ""));
  const timeStepIndex = Math.max(
    Number(state.scriptStepIndex || 0),
    Math.min(2, Math.max(0, stepCtx.steps.length - 1))
  );
  const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(timeStepIndex);
  const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
  const lineToSay = getTimeOfferLine(ctx, n, dayHint, windowHint, intent.raw);
  return {
    handled: true,
    routeKind,
    responseMode: "exact_script",
    objective: "time_selection",
    lineToSay,
    requiredClosingPivot: lineToSay,
    forbiddenTopics: [],
    stateWrites: {
      ...(dayHint ? { selectedDay: dayHint } : {}),
      ...(windowHint ? { selectedWindow: windowHint } : {}),
      pendingLiveTransferAvailabilityConfirm: false,
      pendingLiveTransferAvailabilityAttempts: 0,
      scriptStepIndex: timeStepIndex,
      timeOfferCountForStepIndex: timeStepIndex,
      timeOfferCount: n + 1,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: Math.max(0, timeStepIndex - 1),
    },
    shouldAdvanceStep: false,
  };
}

function buildPostCoverageCurrentPivot(
  state: CallState,
  intent: TurnIntent,
  ctx: AICallContext,
  stepCtx: { idx: number; steps: string[]; stepType: StepType }
): { pivot: string; stateWrites: Record<string, unknown> } {
  const raw = String(intent.raw || "");
  const liveTransferEnabled = !!(ctx as any)?.liveTransferEnabled && !!(ctx as any)?.liveTransferPhone;
  const explicitNowIntent =
    liveTransferEnabled &&
    !isImmediateTransferSchedulingPreference(raw) &&
    (hasImmediateTransferConfirmation(raw) || hasExplicitAgentTransferCommand(raw));
  if (explicitNowIntent) {
    return {
      pivot: getLiveTransferTryingLine(ctx),
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        liveTransferIntroSpoken: true,
        pendingLiveTransferAfterLine: true,
        awaitingUserAnswer: false,
        awaitingAnswerForStepIndex: undefined,
      },
    };
  }

  const explicitDay = pickDayHint(raw, "");
  const namedDay: string | null = extractNamedWeekday(raw.toLowerCase());
  const rememberedDay = String(state.selectedDay || "").trim().toLowerCase();
  const rememberedNamedDay = rememberedDay && rememberedDay !== "today" && rememberedDay !== "tomorrow" ? rememberedDay : null;
  const dayHint: string | null =
    explicitDay === "today" || explicitDay === "tomorrow"
      ? explicitDay
      : rememberedDay === "today" || rememberedDay === "tomorrow"
        ? rememberedDay
        : namedDay || rememberedNamedDay
          || pickDayHint(raw, String(state.lastAcceptedUserText || ""));
  const windowHint = pickTimeWindowHint(raw, String(state.lastAcceptedUserText || ""));
  const hasExactTime = isExactClockTimeMentioned(raw);
  const hasWindow = !!windowHint;

  if (hasExactTime) {
    const timeStepIndex = Math.max(
      Number(state.scriptStepIndex || 0),
      Math.min(3, Math.max(0, stepCtx.steps.length - 1))
    );
    const pivot = `Does ${raw} still work for you?`;
    return {
      pivot,
      stateWrites: {
        selectedTimeText: raw,
        lastExactTimeText: raw,
        lastExactTimeAtMs: Date.now(),
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        scriptStepIndex: timeStepIndex,
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: Math.max(0, timeStepIndex - 1),
      },
    };
  }

  if (dayHint || hasWindow || isTimeIndecisionOrAvailability(raw) || String(state.selectedDay || "").trim()) {
    const timeStepIndex = Math.max(
      Number(state.scriptStepIndex || 0),
      Math.min(2, Math.max(0, stepCtx.steps.length - 1))
    );
    const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(timeStepIndex);
    const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
    const pivot = getTimeOfferLine(ctx, n, dayHint, windowHint, raw);
    return {
      pivot,
      stateWrites: {
        ...(dayHint ? { selectedDay: dayHint } : {}),
        ...(windowHint ? { selectedWindow: windowHint } : {}),
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        scriptStepIndex: timeStepIndex,
        timeOfferCountForStepIndex: timeStepIndex,
        timeOfferCount: n + 1,
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: Math.max(0, timeStepIndex - 1),
      },
    };
  }

  return {
    pivot: getStateAwareClosingPivot(state),
    stateWrites: {
      pendingLiveTransferAvailabilityConfirm: false,
      pendingLiveTransferAvailabilityAttempts: 0,
    },
  };
}

function buildPostCoverageSoftDecision(
  state: CallState,
  intent: TurnIntent,
  ctx: AICallContext,
  stepCtx: { idx: number; steps: string[]; stepType: StepType },
  routeKind: string,
  objective: string,
  baseAnswer: string,
  extraStateWrites: Record<string, unknown> = {}
): PolicyDecision {
  const pivot = buildPostCoverageCurrentPivot(state, intent, ctx, stepCtx);
  return {
    handled: true,
    routeKind,
    responseMode: "guided_gpt",
    objective,
    baseAnswer,
    userText: intent.raw,
    lineToSay: `${baseAnswer} ${pivot.pivot}`,
    requiredClosingPivot: pivot.pivot,
    forbiddenTopics: [
      "pricing specifics",
      "coverage details",
      "program explanation",
      "discovery questions",
      "third-party advice",
    ],
    stateWrites: {
      ...pivot.stateWrites,
      ...extraStateWrites,
    },
    shouldAdvanceStep: false,
  };
}

function classifyTurnIntent(
  lastUserText: string,
  state: CallState,
  stepCtx: { idx: number; steps: string[]; stepType: StepType }
): TurnIntent {
  const raw = String(lastUserText || "").trim();
  const t = raw.toLowerCase();

  if (!t) return { kind: "unknown", raw };

  // Priority 1: angry or profane
  const hasProfanity =
    t.includes("fuck") || t.includes("shit") || t.includes("asshole") ||
    t.includes("bastard") || t.includes("bitch") || t.includes("damn you") ||
    t.includes("hell with") || t.includes("go to hell");
  const hasAngerSignal =
    t.includes("stop calling me") ||
    t.includes("leave me alone") ||
    t.includes("this is ridiculous") ||
    t.includes("i keep telling you") ||
    (t.includes("how many times") && (t.includes("told") || t.includes("said") || t.includes("tell"))) ||
    t.includes("ive told you") || t.includes("i've told you") ||
    t.includes("you people") ||
    t.includes("never call me again") ||
    t.includes("dont call me again") || t.includes("don't call me again");
  if (hasProfanity || hasAngerSignal) {
    return { kind: "angry_or_profane", raw };
  }

  // Priority 2: "I just said" correction (frustration that AI re-asked something already answered)
  const hasJustSaidSignal =
    t.includes("i just said") || t.includes("i already said") ||
    t.includes("i already told you") || t.includes("i told you that") ||
    t.includes("you keep asking") || t.includes("stop asking") ||
    t.includes("i just told you");
  const hasSchedulingContext =
    t.includes("today") || t.includes("tomorrow") || t.includes("morning") ||
    t.includes("afternoon") || t.includes("evening") || t.includes("time") ||
    t.includes("daytime");
  if (hasJustSaidSignal && hasSchedulingContext) {
    return { kind: "confusion", subKind: "i_just_said", raw };
  }

  const identityConfusionSignal =
    t.includes("kayla who") ||
    t.includes("i dont know kayla") ||
    t.includes("i don't know kayla") ||
    t.includes("dont know kayla") ||
    t.includes("don't know kayla");
  if (identityConfusionSignal) {
    return { kind: "confusion", subKind: "confused_identity", raw };
  }

  // Priority 3: hearing problem
  const hearingSignals = [
    "can you repeat", "could you repeat", "say that again", "say it again",
    "didn't catch", "couldn't hear", "can't hear", "cannot hear",
    "what did you say", "come again", "speak up", "louder",
    "i'm sorry what", "im sorry what",
    "did you hear me", "did you not hear", "did you just not hear",
    "are you listening", "are you even listening",
    "hello are you there", "you there", "can you hear me",
    "hello?", "hello hello",
    "breaking up", "cutting out", "static", "too quiet", "barely hear",
    "hard to hear", "hardly hear",
  ];
  if (hearingSignals.some(s => t.includes(s)) || t === "what" || t === "huh" || t === "what?") {
    return { kind: "hearing_problem", raw };
  }

  // Priority 3.4: greeting-phase hearing check — short negatives during greeting ("no", "nope")
  // can mean "I can't hear you." Only fire during awaiting_greeting_reply to avoid
  // mis-classifying genuine "no" answers during the script.
  if (state.phase === "awaiting_greeting_reply") {
    try {
      if (isGreetingNegativeHearing(t)) {
        return { kind: "hearing_problem", subKind: "greeting_phase", raw };
      }
    } catch {}
  }

  // Priority 3.5: greeting ack — user is acknowledging the AI during greeting phase.
  // Must be checked AFTER hearing_problem so "what?" stays as hearing_problem.
  if (state.phase === "awaiting_greeting_reply") {
    try {
      if (isConversationalGreetingContinue(t)) {
        return { kind: "greeting_ack", raw };
      }
    } catch {}
  }

  // Priority 3.7: Step 1 coverage subject answer — BEFORE detectObjection/detectQuestion so
  // "just me", "myself", "spouse" etc. are never misclassified as objections or questions.
  try {
    const scriptKeyNorm = normalizeScriptKey((state as any)?.context?.scriptKey);
    if (scriptKeyNorm !== "kayla_signup" && stepCtx.idx === 1 && isStepOneCoverageSubjectAnswer(t)) {
      return { kind: "coverage_subject_answer", raw };
    }
  } catch {}

  // Priority 4: existing detectors
  try {
    const objKind = detectObjection(t);
    if (objKind === "not_interested") return { kind: "not_interested", subKind: objKind, raw };
    if (objKind === "confused_identity") return { kind: "confusion", subKind: objKind, raw };
    if (objKind) return { kind: "objection", subKind: objKind, raw };
  } catch {}

  try {
    const qKind = detectQuestionKindForTurn(t);
    if (qKind) return { kind: "question", subKind: qKind, raw };
  } catch {}

  // Priority 4.8: "neither works" / no options — catch before day detection
  try {
    if (
      t.includes("neither") || t.includes("none of those") ||
      (t.includes("no neither")) ||
      (t.includes("don't work") && !t.includes("today") && !t.includes("tomorrow")) ||
      (t.includes("doesn't work") && !t.includes("today") && !t.includes("tomorrow"))
    ) {
      return { kind: "time_window", subKind: "none_work", raw };
    }
  } catch {}

  // Priority 5: day/time detection — MUST run before live-transfer yes/no.
  // "probably tomorrow", "tomorrow works", "tomorrow afternoon" → day_selection, never live_transfer_later.
  // extractExplicitDaySelection is unconditional (not gated by isTimeMentioned) so it catches all day phrases.
  try {
    const day = extractExplicitDaySelection(t);
    if (day === "today" || day === "tomorrow") return { kind: "day_selection", raw };
    const namedDay = extractNamedWeekday(t);
    if (namedDay) return { kind: "day_selection", subKind: namedDay, raw };
    if (isTimeMentioned(t) || looksLikeTimeAnswer(t)) {
      if (isTimeWindowMentioned(t)) return { kind: "time_window", raw };
      return { kind: "exact_time", raw };
    }
  } catch {}

  // Priority 6: live-transfer yes/no — only when no explicit day/time was detected above.
  try {
    if (isLiveTransferAvailabilityYes(t) && !isImmediateTransferSchedulingPreference(t)) {
      return { kind: "live_transfer_now", raw };
    }
    if (isLiveTransferAvailabilityNo(t) || isImmediateTransferSchedulingPreference(t)) {
      return { kind: "live_transfer_later", raw };
    }
  } catch {}

  // Priority 7: script advance or reprompt — only when awaiting answer in in_call phase.
  try {
    if (state.phase === "in_call" && state.awaitingUserAnswer) {
      const audioMs = Number(state.userAudioMsBuffered || 0);
      if (shouldTreatCommitAsRealAnswer(stepCtx.stepType, audioMs, t)) {
        return { kind: "script_advance", raw };
      }
      return { kind: "reprompt_step", raw };
    }
  } catch {}

  return { kind: "unknown", raw };
}

function getVerticalProductAnswer(ctx: AICallContext): string {
  const k = normalizeScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim();
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();
  if (k === "mortgage_protection" || k === "veteran_mortgage" || k === "trucker_mortgage") {
    return `Yeah — mortgage protection is a type of insurance that pays off or pays down your house in the event of a death or disability. So if something were to happen to you, your family keeps the home. And these policies do come with living benefits too — so if you get sick or disabled, depending on the policy, it can pay out upfront while you're still here. ${agent} will go over exactly what fits your situation on the call.`;
  }
  if (k === "final_expense") {
    return `Final expense coverage is designed to cover burial costs, medical bills, and end-of-life expenses so your family isn't left with that burden. Most options are whole life — they don't expire and there's no medical exam required. ${agent} will go over what fits your situation best.`;
  }
  if (k === "iul_cash_value" || k === "veteran_iul" || k === "trucker_iul") {
    return `An IUL — indexed universal life — is a type of life insurance that also builds cash value over time. A lot of people use it to grow money tax-advantaged that they can borrow against later, while still having the life insurance protection. ${agent} will walk you through exactly how it works and what you'd qualify for.`;
  }
  if (k === "veteran_leads") {
    return `These programs are specifically designed for veterans — a lot of the companies ${agent} works with offer veteran discounts and immediate coverage, no two-year waiting period like VA life insurance. ${agent} will check exactly what you qualify for.`;
  }
  if (k === "trucker_leads") {
    return `These programs are built around the specific needs of truckers — a lot of carriers work directly with truckers and offer better rates than standard life insurance for drivers. ${agent} will find the best fit for your situation.`;
  }
  if (k === "kayla_signup") {
    return `CoveCRM is an AI-powered CRM built specifically for insurance agents. It includes an AI voice agent — what you're talking to right now — that calls your leads and books appointments automatically, an AI text assistant for SMS follow-ups, a power dialer, Facebook lead integration, Google Calendar sync, and a full lead management system. ${agent} can walk you through a full live demo on a quick call.`;
  }
  if (k === "generic_life") {
    return `These are life insurance options — depending on what you qualify for it could be term, whole life, IUL, or a policy with living benefits built in. The right fit depends on your situation, your health, and your goals. ${agent} will go over all the options and find what makes the most sense for you.`;
  }
  return `We work with multiple types of coverage — whole life, term, IUL, final expense, mortgage protection. What fits best depends on what you qualify for and what your goal is. ${agent} works with multiple carriers to find you the best rate.`;
}

function handlePostCoverageSchedulingTurn(
  state: CallState,
  intent: TurnIntent,
  ctx: AICallContext,
  stepCtx: { idx: number; steps: string[]; stepType: StepType }
): PolicyDecision | null {
  if (!isPostCoverageSchedulingState(state)) return null;

  const closingPivot = getStateAwareClosingPivot(state);
  const agentFirst = getAgentFirstName(ctx);
  const aiName = (ctx.voiceProfile?.aiName || "Alex").trim() || "Alex";
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);
  const liveTransferEnabled = !!(ctx as any)?.liveTransferEnabled && !!(ctx as any)?.liveTransferPhone;
  const raw = String(intent.raw || "");
  const t = raw.toLowerCase();
  const selectedTime = String((state as any).lastExactTimeText || state.selectedTimeText || "").trim();

  if (
    t.includes("wrong number") ||
    t.includes("stop calling") ||
    t.includes("do not call") ||
    t.includes("don't call") ||
    t.includes("remove me") ||
    t.includes("take me off")
  ) {
    return {
      handled: true,
      routeKind: "post_coverage_hard_stop",
      responseMode: "exact_script",
      objective: "end_call",
      lineToSay: "I understand — I'll make a note and remove you. Sorry for the interruption. Take care.",
      requiredClosingPivot: "",
      forbiddenTopics: [],
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
      },
      shouldAdvanceStep: false,
    };
  }

  if (intent.kind === "hearing_problem") {
    const repeatLine = String(state.lastPromptLine || "").trim();
    return {
      handled: true,
      routeKind: "post_coverage_repeat",
      responseMode: "exact_script",
      objective: "repeat_last_prompt",
      lineToSay: repeatLine || closingPivot,
      requiredClosingPivot: repeatLine || closingPivot,
      forbiddenTopics: [],
      stateWrites: {},
      shouldAdvanceStep: false,
    };
  }

  if (intent.kind === "live_transfer_now" && liveTransferEnabled) {
    const explicitNow =
      hasImmediateTransferConfirmation(raw) ||
      hasExplicitAgentTransferCommand(raw) ||
      (!!state.pendingLiveTransferAvailabilityConfirm && !isImmediateTransferSchedulingPreference(raw));
    if (explicitNow) {
      return {
        handled: true,
        routeKind: "post_coverage_live_transfer_try",
        responseMode: "exact_script",
        objective: "start_live_transfer_after_intro",
        lineToSay: getLiveTransferTryingLine(ctx),
        requiredClosingPivot: "",
        forbiddenTopics: [],
        stateWrites: {
          pendingLiveTransferAvailabilityConfirm: false,
          pendingLiveTransferAvailabilityAttempts: 0,
          liveTransferIntroSpoken: true,
          pendingLiveTransferAfterLine: true,
          awaitingUserAnswer: false,
          awaitingAnswerForStepIndex: undefined,
        },
        shouldAdvanceStep: false,
      };
    }
  }

  if (
    liveTransferEnabled &&
    !isImmediateTransferSchedulingPreference(raw) &&
    (hasImmediateTransferConfirmation(raw) || hasExplicitAgentTransferCommand(raw))
  ) {
    return {
      handled: true,
      routeKind: "post_coverage_live_transfer_try",
      responseMode: "exact_script",
      objective: "start_live_transfer_after_intro",
      lineToSay: getLiveTransferTryingLine(ctx),
      requiredClosingPivot: "",
      forbiddenTopics: [],
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        liveTransferIntroSpoken: true,
        pendingLiveTransferAfterLine: true,
        awaitingUserAnswer: false,
        awaitingAnswerForStepIndex: undefined,
      },
      shouldAdvanceStep: false,
    };
  }

  if (intent.kind === "day_selection" || intent.kind === "scheduling_preference" || intent.kind === "live_transfer_later") {
    return buildPostCoverageTimeOfferDecision(state, intent, ctx, stepCtx, "post_coverage_time_offer", intent.kind);
  }

  if (intent.kind === "time_window") {
    if (intent.subKind === "none_work") {
      return {
        handled: true,
        routeKind: "post_coverage_none_work",
        responseMode: "exact_script",
        objective: "time_refinement",
        lineToSay: "No problem — are mornings or afternoons generally better for you?",
        requiredClosingPivot: "Are mornings or afternoons generally better for you?",
        forbiddenTopics: [],
        stateWrites: {
          pendingLiveTransferAvailabilityConfirm: false,
          pendingLiveTransferAvailabilityAttempts: 0,
          awaitingUserAnswer: true,
          awaitingAnswerForStepIndex: Math.max(0, Number(state.scriptStepIndex || stepCtx.idx) - 1),
        },
        shouldAdvanceStep: false,
      };
    }
    return buildPostCoverageTimeOfferDecision(state, intent, ctx, stepCtx, "post_coverage_time_window", "window_selected");
  }

    // Guard: "right now" misclassified as exact_time → redirect to live transfer
    if (intent.kind === "exact_time" && liveTransferEnabled && hasImmediateTransferConfirmation(raw)) {
      return {
        handled: true,
        routeKind: "post_coverage_live_transfer_try",
        responseMode: "exact_script",
        objective: "start_live_transfer_after_intro",
        lineToSay: getLiveTransferTryingLine(ctx),
        requiredClosingPivot: "",
        forbiddenTopics: [],
        stateWrites: {
          pendingLiveTransferAvailabilityConfirm: false,
          pendingLiveTransferAvailabilityAttempts: 0,
          liveTransferIntroSpoken: true,
          pendingLiveTransferAfterLine: true,
          awaitingUserAnswer: false,
          awaitingAnswerForStepIndex: undefined,
        },
        shouldAdvanceStep: false,
      };
    }

  if (intent.kind === "exact_time") {
    const timeStepIndex = Math.max(
      Number(state.scriptStepIndex || 0),
      Math.min(3, Math.max(0, stepCtx.steps.length - 1))
    );
    const lineToSay = `Perfect — I have ${raw} as the time. Does that still work for you?`;
    return {
      handled: true,
      routeKind: "post_coverage_exact_time",
      responseMode: "exact_script",
      objective: "confirm_exact_time",
      lineToSay,
      requiredClosingPivot: lineToSay,
      forbiddenTopics: [],
      stateWrites: {
        selectedTimeText: raw,
        lastExactTimeText: raw,
        lastExactTimeAtMs: Date.now(),
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        scriptStepIndex: timeStepIndex,
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: Math.max(0, timeStepIndex - 1),
      },
      shouldAdvanceStep: false,
    };
  }

  if (intent.kind === "coverage_subject_answer") {
    const selectedDay = String(state.selectedDay || "").trim().toLowerCase();
    if (selectedDay === "today" || selectedDay === "tomorrow") {
      return buildPostCoverageTimeOfferDecision(state, intent, ctx, stepCtx, "post_coverage_coverage_repeat_time_offer", "coverage_repeat_with_day");
    }
    const lineToSay = `Got it — does later today or tomorrow work better for that quick call with ${agentFirst}?`;
    return {
      handled: true,
      routeKind: "post_coverage_coverage_repeat",
      responseMode: "exact_script",
      objective: "return_to_scheduling",
      lineToSay,
      requiredClosingPivot: lineToSay,
      forbiddenTopics: [],
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: Math.max(0, Number(state.scriptStepIndex || stepCtx.idx) - 1),
      },
      shouldAdvanceStep: false,
    };
  }

  if (intent.kind === "angry_or_profane") {
    return buildPostCoverageSoftDecision(
      state,
      intent,
      ctx,
      stepCtx,
      "post_coverage_angry_recover",
      "recover_to_scheduling",
      "Acknowledge their frustration calmly and apologize without arguing."
    );
  }

  if (intent.kind === "confusion" && intent.subKind === "confused_identity") {
    return buildPostCoverageSoftDecision(
      state,
      intent,
      ctx,
      stepCtx,
      "post_coverage_identity",
      "identify_and_return_to_scheduling",
      `Explain that you are ${aiName}, a scheduling assistant calling for ${agentFirst} about the ${scope} request.`
    );
  }

  if (intent.kind === "confusion" && intent.subKind === "i_just_said") {
    const explicitDay = extractExplicitDaySelection(raw);
    if (explicitDay === "today" || explicitDay === "tomorrow") {
      const decision = buildPostCoverageTimeOfferDecision(state, intent, ctx, stepCtx, "post_coverage_correction_time_offer", "i_just_said_day");
      decision.lineToSay = `You're right — sorry about that. ${String(decision.lineToSay || "").replace(/^Got it\s*[—\-–]\s*/i, "")}`;
      return decision;
    }
    return {
      handled: true,
      routeKind: "post_coverage_correction",
      responseMode: "exact_script",
      objective: "recover_to_current_scheduling_state",
      lineToSay: `You're right — sorry about that. ${closingPivot}`,
      requiredClosingPivot: closingPivot,
      forbiddenTopics: [],
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
      },
      shouldAdvanceStep: false,
    };
  }

  if (intent.kind === "not_interested") {
    const lineToSay = getRebuttalLine(ctx, "not_interested");
    return {
      handled: true,
      routeKind: "post_coverage_not_interested",
      responseMode: "exact_script",
      objective: "soft_recover_to_scheduling",
      lineToSay,
      requiredClosingPivot: lineToSay,
      forbiddenTopics: [],
      stateWrites: {},
      shouldAdvanceStep: false,
    };
  }

  if (intent.kind === "objection" || intent.kind === "question") {
    const sk = intent.subKind || "";
    const closingQ = getStateAwareClosingPivot(state);

    // Scam: deterministic rebuttal
    if (sk === "scam") {
      const lineToSay = buildDeterministicScamRebuttalLine(state);
      return {
        handled: true,
        routeKind: "post_coverage_scam",
        responseMode: "exact_script",
        objective: "answer_then_return_to_scheduling",
        lineToSay,
        requiredClosingPivot: lineToSay,
        forbiddenTopics: [],
        stateWrites: {},
        shouldAdvanceStep: false,
      };
    }

    // Duration question: answer directly
    if (sk === "what_entails" || isHowLongDurationQuestion(raw)) {
      const lineToSay = `Really quick — usually 5 to 10 minutes. ${agentFirst} just covers your ${scope} request, answers your questions, and that’s it. ${closingQ}`;
      return {
        handled: true,
        routeKind: "post_coverage_what_entails",
        responseMode: "exact_script",
        objective: "answer_then_return_to_scheduling",
        lineToSay,
        requiredClosingPivot: closingQ,
        forbiddenTopics: [],
        stateWrites: {},
        shouldAdvanceStep: false,
      };
    }

    // Generic product question: guide OpenAI to answer from its vertical knowledge
    if (sk === "generic_question") {
      const productKnowledge = getVerticalProductAnswer(ctx);
      const lineToSay = `${productKnowledge} ${closingQ}`;
      return {
        handled: true,
        routeKind: "post_coverage_product_question",
        responseMode: "exact_script",
        objective: "answer_product_question_then_schedule",
        lineToSay,
        requiredClosingPivot: closingQ,
        forbiddenTopics: [],
        stateWrites: {},
        shouldAdvanceStep: false,
      };
    }

    // All other objections: use the actual rebuttal lines
    const lineToSay = getRebuttalLine(ctx, sk || "generic_question");
    return {
      handled: true,
      routeKind: `post_coverage_${sk || intent.kind}`,
      responseMode: "exact_script",
      objective: "answer_then_return_to_scheduling",
      lineToSay,
      requiredClosingPivot: closingQ,
      forbiddenTopics: [],
      stateWrites: {},
      shouldAdvanceStep: false,
    };
  }

  if (selectedTime && (intent.kind === "live_transfer_now" || intent.kind === "unknown")) {
    const lineToSay = `Perfect — does ${selectedTime} still work for you?`;
    return {
      handled: true,
      routeKind: "post_coverage_exact_time_confirm",
      responseMode: "exact_script",
      objective: "confirm_exact_time",
      lineToSay,
      requiredClosingPivot: lineToSay,
      forbiddenTopics: [],
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: Math.max(0, Number(state.scriptStepIndex || stepCtx.idx) - 1),
      },
      shouldAdvanceStep: false,
    };
  }

  const _unknownPivot = buildPostCoverageCurrentPivot(state, intent, ctx, stepCtx);
  return {
    handled: true,
    routeKind: "post_coverage_unknown_free",
    responseMode: "free_response",
    objective: "open_question",
    userText: intent.raw,
    lineToSay: _unknownPivot.pivot,
    requiredClosingPivot: _unknownPivot.pivot,
    forbiddenTopics: [],
    stateWrites: { ..._unknownPivot.stateWrites },
    shouldAdvanceStep: false,
  };
}

function buildConversationPolicyDecision(
  intent: TurnIntent,
  state: CallState,
  stepCtx: { idx: number; steps: string[]; stepType: StepType }
): PolicyDecision {
  const NOT_HANDLED: PolicyDecision = {
    handled: false,
    routeKind: "pass_through",
    responseMode: "guided_gpt",
    objective: "",
    requiredClosingPivot: getStateAwareClosingPivot(state),
    forbiddenTopics: [],
    stateWrites: {},
    shouldAdvanceStep: false,
  };

  const closingPivot = getStateAwareClosingPivot(state);
  const ctx = state.context!;

  // Strip "Got it — " prefix so time-offer body can be embedded mid-sentence.
  function offerBody(line: string): string {
    return String(line || "").replace(/^Got it\s*[—\-–]\s*/i, "");
  }
  function ucFirst(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // ── Branch: greeting ack (only during awaiting_greeting_reply phase) ──────
  // "yep", "yeah", "what's up", etc. → advance to first script step, never reprompt.
  if (intent.kind === "greeting_ack") {
    if (!ctx) return NOT_HANDLED;
    const lineToSay = stepCtx.steps[0] || getBookingFallbackLine(ctx);
    return {
      handled: true,
      routeKind: "greeting_ack",
      responseMode: "exact_script",
      objective: "advance_to_step_0",
      lineToSay,
      requiredClosingPivot: "",
      forbiddenTopics: [],
      stateWrites: {
        phase: "awaiting_greeting_reply",   // keep in greeting phase; greetingAdvancePending drives the transition
        greetingAdvancePending: true,
        greetingAdvanceNextIndex: 1,
        greetingAdvanceNextPhase: "in_call",
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: 0,
        scriptStepIndex: 0,
      },
      shouldAdvanceStep: false,
    };
  }

  if (intent.kind === "hearing_problem") {
    if (intent.subKind === "greeting_phase" && ctx) {
      const aiName = (ctx.voiceProfile?.aiName || "Alex").trim() || "Alex";
      const clientName = (ctx.clientFirstName || "").trim() || "there";
      const lineToSay = `Okay — can you hear me now, ${clientName}? This is ${aiName}.`;
      return {
        handled: true,
        routeKind: "policy_greeting_hearing_retry",
        responseMode: "exact_script",
        objective: "hearing_check",
        lineToSay,
        requiredClosingPivot: lineToSay,
        forbiddenTopics: [],
        stateWrites: {
          phase: "awaiting_greeting_reply",
          awaitingUserAnswer: true,
          awaitingAnswerForStepIndex: 0,
        },
        shouldAdvanceStep: false,
      };
    }
    const repeatLine = String(state.lastPromptLine || "").trim();
    const greetingFallback = (() => {
      const n = (ctx?.voiceProfile?.aiName || "Alex").trim() || "Alex";
      return `Sorry — can you hear me okay? This is ${n}.`;
    })();
    const lineToSay = repeatLine ||
      (state.phase === "awaiting_greeting_reply" ? greetingFallback : "Sure — I was just asking if later today or tomorrow works better.");
    return {
      handled: true,
      routeKind: "policy_repeat",
      responseMode: "exact_script",
      objective: "repeat_last_prompt",
      lineToSay,
      requiredClosingPivot: lineToSay,
      forbiddenTopics: [],
      stateWrites: state.phase === "awaiting_greeting_reply"
        ? { phase: "awaiting_greeting_reply", awaitingUserAnswer: true, awaitingAnswerForStepIndex: 0 }
        : {},
      shouldAdvanceStep: false,
    };
  }

  // Identity recovery must work even before the call has fully advanced into in_call.
  if (intent.kind === "confusion" && intent.subKind === "confused_identity") {
    if (!ctx) return NOT_HANDLED;
    const agentFirst = getAgentFirstName(ctx);
    const aiName = (ctx.voiceProfile?.aiName || "Alex").trim() || "Alex";
    const isKayla = normalizeScriptKey(ctx.scriptKey) === "kayla_signup";
    const lineToSay = isKayla
      ? `Sure — I'm ${aiName}, the CoveCRM AI calling on behalf of ${agentFirst}. You requested a call to hear how the AI works — this is actually the demo. ${closingPivot}`
      : `Sure — I'm ${aiName}, a scheduling assistant calling for ${agentFirst} about the ${getScopeLabelForScriptKey(ctx.scriptKey)} request that came in. ${closingPivot}`;
    return {
      handled: true, routeKind: "policy_confused_identity", responseMode: "exact_script",
      objective: "return_to_booking", lineToSay, requiredClosingPivot: closingPivot,
      forbiddenTopics: [], stateWrites: {}, shouldAdvanceStep: false,
    };
  }

  // ── Branch: Step 1 coverage subject answer ───────────────────────────────
  // Placed BEFORE the phase gate so it fires even in edge-case non-in_call phases.
  // "just me", "myself", "both of us", spouse answers → scripted booking frame WITH live-transfer option.
  // Policy is the ONLY path for these turns; old STEP1-HARD-ROUTE is bypassed.
  if (intent.kind === "coverage_subject_answer") {
    if (!ctx) return NOT_HANDLED;
    const agentFirst = getAgentFirstName(ctx);
    const liveTransferEnabled = !!(ctx as any)?.liveTransferEnabled && !!(ctx as any)?.liveTransferPhone;
    const lineToSay = `Got it — I just need to get you scheduled for a quick call with ${agentFirst} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?`;
    const advancedIdx = Math.min(stepCtx.idx + 1, Math.max(0, stepCtx.steps.length - 1));
    return {
      handled: true,
      routeKind: "policy_step1_coverage",
      responseMode: "exact_script",
      objective: "advance_to_booking_frame",
      lineToSay,
      requiredClosingPivot: closingPivot,
      forbiddenTopics: [],
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: liveTransferEnabled,
        pendingLiveTransferAvailabilityAttempts: 0,
        // Advance past Step 1 when no live-transfer pending; keep at Step 1 while waiting for availability answer.
        scriptStepIndex: liveTransferEnabled ? stepCtx.idx : advancedIdx,
      },
      shouldAdvanceStep: false,
    };
  }

  // Post-coverage scheduling only runs in in_call phase.
  if (state.phase === "in_call") {
    const postCoverageDecision = handlePostCoverageSchedulingTurn(state, intent, ctx, stepCtx);
    if (postCoverageDecision?.handled) return postCoverageDecision;
  }

  if (intent.kind === "live_transfer_now") {
    if (state.phase !== "in_call") return NOT_HANDLED;
    if (!ctx || !(ctx as any)?.liveTransferEnabled || !(ctx as any)?.liveTransferPhone) {
      return NOT_HANDLED;
    }
    const explicitNow =
      !!state.pendingLiveTransferAvailabilityConfirm ||
      hasImmediateTransferConfirmation(intent.raw) ||
      hasExplicitAgentTransferCommand(intent.raw);
    if (!explicitNow) return NOT_HANDLED;
    return {
      handled: true,
      routeKind: "policy_live_transfer_try",
      responseMode: "exact_script",
      objective: "start_live_transfer_after_intro",
      lineToSay: getLiveTransferTryingLine(ctx),
      requiredClosingPivot: "",
      forbiddenTopics: [],
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        liveTransferIntroSpoken: true,
        pendingLiveTransferAfterLine: true,
        awaitingUserAnswer: false,
        awaitingAnswerForStepIndex: undefined,
      },
      shouldAdvanceStep: false,
    };
  }

  if (intent.kind === "live_transfer_later" || intent.kind === "scheduling_preference") {
    if (state.phase !== "in_call") return NOT_HANDLED;
    if (!ctx) return NOT_HANDLED;
    const explicitDay = pickDayHint(intent.raw, "");
    const rememberedDay = String(state.selectedDay || "").trim().toLowerCase();
    const dayHint =
      explicitDay === "today" || explicitDay === "tomorrow"
        ? explicitDay
        : rememberedDay === "today" || rememberedDay === "tomorrow"
          ? (rememberedDay as "today" | "tomorrow")
          : pickDayHint(intent.raw, String(state.lastAcceptedUserText || ""));
    const windowHint = pickTimeWindowHint(intent.raw, String(state.lastAcceptedUserText || ""));
    const lineToSay = getTimeOfferLine(ctx, 0, dayHint, windowHint, intent.raw);
    const advancedIdx = Math.min(Number(state.scriptStepIndex || 0) + 1, Math.max(0, stepCtx.steps.length - 1));
    return {
      handled: true,
      routeKind: "policy_live_transfer_later",
      responseMode: "exact_script",
      objective: "time_selection",
      lineToSay,
      requiredClosingPivot: lineToSay,
      forbiddenTopics: [],
      stateWrites: {
        ...(dayHint ? { selectedDay: dayHint } : {}),
        ...(windowHint ? { selectedWindow: windowHint } : {}),
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
        scriptStepIndex: Math.max(advancedIdx, Math.min(2, Math.max(0, stepCtx.steps.length - 1))),
        timeOfferCountForStepIndex: Math.max(advancedIdx, Math.min(2, Math.max(0, stepCtx.steps.length - 1))),
        timeOfferCount: 1,
      },
      shouldAdvanceStep: false,
    };
  }

  // ── Branch: angry or profane ──────────────────────────────────────────────
  if (intent.kind === "angry_or_profane") {
    const t = intent.raw.toLowerCase();
    const isDNC =
      t.includes("do not call") || t.includes("don't call") ||
      t.includes("remove") || t.includes("stop calling") ||
      t.includes("leave me alone") || t.includes("never call");
    if (isDNC) {
      return {
        handled: true,
        routeKind: "angry_hard_stop",
        responseMode: "exact_script",
        objective: "end_call",
        lineToSay: "I completely understand — I'll make a note and remove you right away. Sorry for the interruption. Take care.",
        requiredClosingPivot: "",
        forbiddenTopics: [],
        stateWrites: {},
        shouldAdvanceStep: false,
      };
    }
    return {
      handled: true,
      routeKind: "angry_soft",
      responseMode: "exact_script",
      objective: "return_to_booking",
      lineToSay: `I hear you — I'm sorry about that. ${closingPivot}`,
      requiredClosingPivot: closingPivot,
      forbiddenTopics: [],
      stateWrites: {},
      shouldAdvanceStep: false,
    };
  }

  // ── Branch: "I just said" correction ─────────────────────────────────────
  if (intent.kind === "confusion" && intent.subKind === "i_just_said") {
    const raw = intent.raw.toLowerCase();
    let correctionDay: "today" | "tomorrow" | null = null;
    if (raw.includes("tomorrow")) correctionDay = "tomorrow";
    else if (raw.includes("today")) correctionDay = "today";
    const stateWrites: Record<string, unknown> = {};
    let lineToSay: string;
    if (correctionDay) {
      stateWrites["selectedDay"] = correctionDay;
      try {
        const offer = getTimeOfferLine(ctx, 0, correctionDay, null, "");
        lineToSay = `You're right — sorry about that. ${ucFirst(offerBody(offer))}`;
      } catch {
        lineToSay = `You're right — sorry about that. Does ${correctionDay === "today" ? "later today" : "tomorrow"} work?`;
      }
    } else {
      const sd = String(state.selectedDay || "").trim().toLowerCase();
      if ((sd === "today" || sd === "tomorrow") && ctx) {
        try {
          const offer = getTimeOfferLine(ctx, 0, sd as "today" | "tomorrow", null, "");
          lineToSay = `You're right — sorry about that. ${ucFirst(offerBody(offer))}`;
        } catch {
          lineToSay = `You're right — sorry about that. ${closingPivot}`;
        }
      } else {
        lineToSay = `You're right — sorry about that. ${closingPivot}`;
      }
    }
    return {
      handled: true,
      routeKind: "correction",
      responseMode: "exact_script",
      objective: "return_to_booking",
      lineToSay,
      requiredClosingPivot: closingPivot,
      forbiddenTopics: [],
      stateWrites,
      shouldAdvanceStep: false,
    };
  }

  // ── Branch: confused identity ─────────────────────────────────────────────
  // "Who is this?" / "Who are you?" — introduce AI name + agent + scope, return to booking.
  if (intent.kind === "confusion" && intent.subKind === "confused_identity") {
    if (!ctx) return NOT_HANDLED;
    const agentFirst = getAgentFirstName(ctx);
    const aiName = (ctx.voiceProfile?.aiName || "Alex").trim() || "Alex";
    const isKayla = normalizeScriptKey(ctx.scriptKey) === "kayla_signup";
    const lineToSay = isKayla
      ? `Sure — I'm ${aiName}, the CoveCRM AI calling on behalf of ${agentFirst}. You requested a call to hear how the AI works — this is actually the demo. ${closingPivot}`
      : `Sure — I'm ${aiName}, a scheduling assistant calling for ${agentFirst} about the ${getScopeLabelForScriptKey(ctx.scriptKey)} request that came in. ${closingPivot}`;
    return {
      handled: true, routeKind: "policy_confused_identity", responseMode: "exact_script",
      objective: "return_to_booking", lineToSay, requiredClosingPivot: closingPivot,
      forbiddenTopics: [], stateWrites: {}, shouldAdvanceStep: false,
    };
  }

  // ── Branch: not interested ────────────────────────────────────────────────
  if (intent.kind === "not_interested") {
    if (!ctx) return NOT_HANDLED;
    const agentFirst = getAgentFirstName(ctx);
    const niKind = "not_interested";
    const niIsRepeat = !!state.lastObjectionKind && state.lastObjectionKind === niKind;
    const niRepeatCount = niIsRepeat ? (Number(state.objectionRepeatCount ?? 0) + 1) : 1;
    const niRepeatMode = niIsRepeat && niRepeatCount >= 2;
    const niStateWrites: Record<string, unknown> = { lastObjectionKind: niKind, objectionRepeatCount: niRepeatCount };
    if (niRepeatMode) {
      return {
        handled: true, routeKind: "policy_not_interested", responseMode: "soft_script",
        objective: "return_to_booking",
        lineToSay: getRebuttalLine(ctx, niKind),
        requiredClosingPivot: closingPivot,
        forbiddenTopics: [], stateWrites: niStateWrites, shouldAdvanceStep: false,
        repeatMode: true,
      };
    }
    const lineToSay = `Totally fair — and I'm not here to pressure you. Most people who felt that way ended up really glad they took the 5 minutes. ${agentFirst} keeps it quick. ${closingPivot}`;
    return {
      handled: true, routeKind: "policy_not_interested", responseMode: "exact_script",
      objective: "return_to_booking", lineToSay, requiredClosingPivot: closingPivot,
      forbiddenTopics: [], stateWrites: niStateWrites, shouldAdvanceStep: false,
    };
  }

  // ── Branch: all objections and questions ──────────────────────────────────
  // Policy is the single brain for every named objection/question kind.
  // Each response: acknowledge naturally + brief answer + state-aware closing pivot.
  // Old rebuttal gate (after policy intercept) is now fallback-only for unhandled subKinds.
  if (intent.kind === "objection" || intent.kind === "question") {
    if (!ctx) return NOT_HANDLED;
    const agentFirst = getAgentFirstName(ctx);
    const aiName = (ctx.voiceProfile?.aiName || "Alex").trim() || "Alex";
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    const isKayla = normalizeScriptKey(ctx.scriptKey) === "kayla_signup";
    const sk = intent.subKind || "";
    let lineToSay: string;

    if (sk === "scam") {
      lineToSay = buildDeterministicScamRebuttalLine(state);
    } else if (sk === "how_much") {
      lineToSay = isKayla
        ? `It’s $199.99 a month flat — unlimited users, all features included. There’s a 7-day free trial and the code COVE50 saves $50 off the first month. ${closingPivot}`
        : `That depends on the coverage and what you qualify for — ${agentFirst} will walk through the actual options with you on the call. ${closingPivot}`;
    } else if (sk === "what_entails") {
      // BUG-014: Kayla — route to the correct product answer; insurance — scheduling preview.
      lineToSay = isKayla
        ? `${getVerticalProductAnswer(ctx)} ${closingPivot}`
        : `Really quick — usually 5 to 10 minutes. ${agentFirst} just covers your ${scope} request, answers your questions, and that’s it. ${closingPivot}`;
    } else if (sk === "are_you_ai") {
      // BUG-010: Remove "licensed agent" language; give Kayla a demo-aware response.
      lineToSay = isKayla
        ? `What you’re hearing right now is exactly what your leads would hear — this is CoveCRM’s AI. It handles objections, answers questions, and books appointments. That’s what you’d be buying. ${closingPivot}`
        : `Yes — I’m a virtual assistant helping with scheduling. ${agentFirst} handles everything on the actual call. ${closingPivot}`;
    } else if (sk === "busy") {
      lineToSay = `No worries — this’ll be really quick. ${closingPivot}`;
    } else if (sk === "send_it" || sk === "send_info") {
      lineToSay = isKayla
        ? `I can text you the signup link and discount code right now — want me to send it over? ${closingPivot}`
        : `I get it — honestly easier on a quick call than back and forth over text. ${agentFirst} keeps it to 5 minutes. ${closingPivot}`;
    } else if (sk === "already_have") {
      lineToSay = isKayla
        ? `That’s fair — a lot of agents on other CRMs switch over once they see how the AI dialer and Facebook webhook work together out of the box. No setup headaches. ${closingPivot}`
        : `That’s great — a lot of people ${agentFirst} works with have coverage but are overpaying or have gaps they didn’t know about. Five minutes to check. ${closingPivot}`;
    } else if (sk === "dont_remember") {
      lineToSay = isKayla
        ? `No worries — a request came through to see how the AI works. ${agentFirst} just wants to make sure you got connected. ${closingPivot}`
        : `No worries — a ${scope} request came through a little while back. ${agentFirst} just wants to make sure you got taken care of. ${closingPivot}`;
    } else if (sk === "how_did_you_get") {
      lineToSay = isKayla
        ? `Your info came through a form requesting a CoveCRM demo. ${agentFirst} just wants to make sure you got what you were looking for. ${closingPivot}`
        : `Your info came through a form submitted online for ${scope}. ${agentFirst} just wants to make sure you’re taken care of. ${closingPivot}`;
    } else if (sk === "generic_question") {
      lineToSay = ctx
        ? `${getVerticalProductAnswer(ctx)} ${closingPivot}`
        : `${agentFirst} can answer that on the call. ${closingPivot}`;
    } else {
      lineToSay = getRebuttalLine(ctx, "generic_question");
    }

    const objKind = sk || intent.kind;
    const objIsRepeat = !!state.lastObjectionKind && state.lastObjectionKind === objKind;
    const objRepeatCount = objIsRepeat ? (Number(state.objectionRepeatCount ?? 0) + 1) : 1;
    const objRepeatMode = objIsRepeat && objRepeatCount >= 2;
    const objStateWrites: Record<string, unknown> = { lastObjectionKind: objKind, objectionRepeatCount: objRepeatCount };

    if (objRepeatMode) {
      const rebuttalBase = getRebuttalLine(ctx, sk) || lineToSay;
      return {
        handled: true,
        routeKind: `policy_${sk || "objection"}`,
        responseMode: "soft_script",
        objective: "return_to_booking",
        lineToSay: rebuttalBase,
        requiredClosingPivot: closingPivot,
        forbiddenTopics: [],
        stateWrites: objStateWrites,
        shouldAdvanceStep: false,
        repeatMode: true,
      };
    }

    return {
      handled: true,
      routeKind: `policy_${sk || "objection"}`,
      responseMode: "exact_script",
      objective: "return_to_booking",
      lineToSay,
      requiredClosingPivot: closingPivot,
      forbiddenTopics: [],
      stateWrites: objStateWrites,
      shouldAdvanceStep: false,
    };
  }

  // ── Branch: explicit day selection (today / tomorrow / any named weekday) ─
  if (intent.kind === "day_selection" && state.phase === "in_call") {
    const explicitDay = pickDayHint(intent.raw, "");
    const namedDay: string | null = (intent.subKind && intent.subKind !== "today" && intent.subKind !== "tomorrow")
      ? intent.subKind
      : extractNamedWeekday(intent.raw.toLowerCase());
    const isStandard = explicitDay === "today" || explicitDay === "tomorrow";
    const dayToUse: string | null = isStandard ? explicitDay : (namedDay || null);
    if (dayToUse) {
      const windowHint = pickTimeWindowHint(intent.raw, "");
      let lineToSay: string;
      try {
        lineToSay = getTimeOfferLine(ctx, 0, dayToUse, windowHint, intent.raw);
      } catch {
        const dayLabel = isStandard
          ? (dayToUse === "today" ? "later today" : "tomorrow")
          : (String(dayToUse).charAt(0).toUpperCase() + String(dayToUse).slice(1));
        lineToSay = `Got it — ${dayLabel} works. ${closingPivot}`;
      }
      const wasLTPending = !!state.pendingLiveTransferAvailabilityConfirm;
      const curIdx = Number(state.scriptStepIndex || 0);
      const advancedDayIdx = Math.min(curIdx + 1, Math.max(0, stepCtx.steps.length - 1));
      return {
        handled: true,
        routeKind: "policy_day_selected",
        responseMode: "exact_script",
        objective: "time_selection",
        lineToSay,
        requiredClosingPivot: closingPivot,
        forbiddenTopics: [],
        stateWrites: {
          selectedDay: dayToUse,
          pendingLiveTransferAvailabilityConfirm: false,
          pendingLiveTransferAvailabilityAttempts: 0,
          ...(wasLTPending && isStandard ? { scriptStepIndex: advancedDayIdx } : {}),
        },
        shouldAdvanceStep: false,
      };
    }
  }

  // ── Branch: time window when day already known ───────────────────────────
  // User says "morning" / "afternoon" / "evening" and we already have selectedDay.
  // Also handles "neither works" / "no neither" → ask for alternative window.
  if (intent.kind === "time_window" && state.phase === "in_call") {
    // "Neither works" / "none of those" → ask for a different window, not repeat same slots.
    if (intent.subKind === "none_work") {
      return {
        handled: true,
        routeKind: "policy_none_work",
        responseMode: "exact_script",
        objective: "time_selection",
        lineToSay: "No problem — are mornings or afternoons generally better for you?",
        requiredClosingPivot: closingPivot,
        forbiddenTopics: [],
        stateWrites: {},
        shouldAdvanceStep: false,
      };
    }
    const sd = String(state.selectedDay || "").trim().toLowerCase();
    if (sd === "today" || sd === "tomorrow") {
      const windowHint = pickTimeWindowHint(intent.raw, "");
      let lineToSay: string;
      try {
        lineToSay = getTimeOfferLine(ctx, 0, sd as "today" | "tomorrow", windowHint, intent.raw);
      } catch {
        lineToSay = closingPivot;
      }
      return {
        handled: true,
        routeKind: "policy_time_window",
        responseMode: "exact_script",
        objective: "time_selection",
        lineToSay,
        requiredClosingPivot: closingPivot,
        forbiddenTopics: [],
        stateWrites: {
          pendingLiveTransferAvailabilityConfirm: false,
          pendingLiveTransferAvailabilityAttempts: 0,
        },
        shouldAdvanceStep: false,
      };
    }
  }

  if (intent.kind === "unknown" || intent.kind === "off_topic") {
    if (state.phase === "awaiting_greeting_reply") return NOT_HANDLED;
    if (!ctx) return NOT_HANDLED;
    return {
      handled: true,
      routeKind: "policy_unknown",
      responseMode: "free_response",
      objective: "open_question",
      userText: intent.raw,
      lineToSay: closingPivot,
      requiredClosingPivot: (() => {
        const currentStep = (stepCtx?.steps || [])[stepCtx?.idx ?? 0];
        return (currentStep && currentStep.trim()) ? currentStep.trim() : closingPivot;
      })(),
      forbiddenTopics: [],
      stateWrites: {
        pendingLiveTransferAvailabilityConfirm: false,
        pendingLiveTransferAvailabilityAttempts: 0,
      },
      shouldAdvanceStep: false,
    };
  }

  // ── Branch: script advance (lead gave a qualifying answer to current step) ─
  if (intent.kind === "script_advance") {
    if (!ctx || state.phase !== "in_call") return NOT_HANDLED;
    const nextIdx = stepCtx.idx + 1;
    const nextStep = stepCtx.steps[nextIdx];

    if (!nextStep) {
      return {
        handled: true,
        routeKind: "policy_script_end",
        responseMode: "exact_script",
        objective: "return_to_booking",
        lineToSay: getStateAwareClosingPivot(state),
        requiredClosingPivot: closingPivot,
        forbiddenTopics: [],
        stateWrites: {
          scriptStepIndex: nextIdx,
          awaitingUserAnswer: false,
          awaitingAnswerForStepIndex: undefined,
          lastAcceptedUserText: intent.raw,
          lastAcceptedStepType: stepCtx.stepType,
          lastAcceptedStepIndex: stepCtx.idx,
        },
        shouldAdvanceStep: true,
      };
    }

    const ackPrefix = getHumanAckPrefixForStepAnswer(stepCtx.stepType, intent.raw);
    const fullLine = ackPrefix ? `${ackPrefix} ${nextStep}` : nextStep;

    return {
      handled: true,
      routeKind: `policy_script_step_${nextIdx}`,
      responseMode: "script_step",
      objective: "script_advance",
      lineToSay: fullLine,
      userText: intent.raw,
      requiredClosingPivot: closingPivot,
      forbiddenTopics: [],
      stateWrites: {
        scriptStepIndex: nextIdx,
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: nextIdx,
        lastAcceptedUserText: intent.raw,
        lastAcceptedStepType: stepCtx.stepType,
        lastAcceptedStepIndex: stepCtx.idx,
      },
      shouldAdvanceStep: true,
    };
  }

  // ── Branch: reprompt step (lead gave insufficient answer) ─────────────────
  if (intent.kind === "reprompt_step") {
    if (!ctx || state.phase !== "in_call") return NOT_HANDLED;
    const repromptN = Number(state.repromptCountForCurrentStep || 0);
    const lineToSay = getRepromptLineForStepType(ctx, stepCtx.stepType, repromptN);
    return {
      handled: true,
      routeKind: "policy_reprompt",
      responseMode: "exact_script",
      objective: "reprompt_step",
      lineToSay,
      requiredClosingPivot: closingPivot,
      forbiddenTopics: [],
      stateWrites: {
        repromptCountForCurrentStep: repromptN + 1,
      },
      shouldAdvanceStep: false,
    };
  }

  // ── Greeting-phase catch-all ─────────────────────────────────────────────
  // day_selection, live_transfer_now/later, time_window, and unknown intents
  // all fall through the phase-gated branches above without a handler.
  // Rather than silencing the call, repeat the last prompt or use a hearing retry.
  if (state.phase === "awaiting_greeting_reply") {
    const aiName = (ctx?.voiceProfile?.aiName || "Alex").trim() || "Alex";
    const clientName = (ctx?.clientFirstName || "").trim() || "there";
    const repeatLine = String(state.lastPromptLine || "").trim();
    const lineToSay = repeatLine || `Sorry about that — can you hear me okay, ${clientName}? This is ${aiName}.`;
    return {
      handled: true,
      routeKind: "policy_greeting_fallback",
      responseMode: "exact_script",
      objective: "greeting_retry",
      lineToSay,
      requiredClosingPivot: lineToSay,
      forbiddenTopics: [],
      stateWrites: {
        phase: "awaiting_greeting_reply",
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: 0,
      },
      shouldAdvanceStep: false,
    };
  }

  return NOT_HANDLED;
}

function buildResponseFromPolicy(
  decision: PolicyDecision,
  state: CallState,
  stepCtx?: { idx: number; steps: string[]; stepType: StepType; expectedAnswerIdx?: number }
): string {
  if (decision.responseMode === "script_step" && decision.lineToSay && state.context) {
    const line = decision.lineToSay;
    if (looksLikeGeneratedTimeOfferLine(line)) {
      return buildExactScriptLineInstruction(line, {
        userText: decision.userText || "",
        recentExchanges: state.recentExchanges,
        scope: state.context ? getScopeLabelForScriptKey(state.context.scriptKey) : "life insurance",
        agent: state.context ? (state.context.agentName || "the agent").split(" ")[0] : "the agent",
        leadName: state.context ? (state.context.clientFirstName || "there") : "there",
      });
    }
    return buildStepperTurnInstruction(state.context, line, {
      userText: decision.userText,
      recentExchanges: state.recentExchanges,
    });
  }
  if (decision.responseMode === "exact_script" && decision.lineToSay) {
    return buildExactScriptLineInstruction(decision.lineToSay || "", {
      userText: decision.userText || "",
      recentExchanges: state.recentExchanges,
      scope: state.context ? getScopeLabelForScriptKey(state.context.scriptKey) : "life insurance",
      agent: state.context ? (state.context.agentName || "the agent").split(" ")[0] : "the agent",
      leadName: state.context ? (state.context.clientFirstName || "there") : "there",
    });
  }
  if (decision.responseMode === "free_response" && state.context) {
    return buildFreeResponseInstruction(state.context, {
      userText: decision.userText || "",
      recentExchanges: state.recentExchanges,
      currentStepLine: decision.requiredClosingPivot ||
        (state.scriptSteps || [])[
          state.awaitingAnswerForStepIndex ?? state.scriptStepIndex ?? 0
        ] || "",
      stepType: stepCtx?.stepType,
    });
  }
  if (decision.responseMode === "soft_script" && decision.lineToSay && state.context) {
    return buildConversationalRebuttalInstruction(state.context, decision.lineToSay, {
      closingPivot: decision.requiredClosingPivot,
      repeatMode: decision.repeatMode,
      recentExchanges: state.recentExchanges,
    });
  }
  if (decision.responseMode === "guided_gpt" && decision.routeKind.startsWith("post_coverage_") && decision.baseAnswer && state.context) {
    return buildPostCoverageControlledResponseInstruction(state.context, {
      userText: decision.userText || "",
      baseAnswer: decision.baseAnswer,
      requiredClosingPivot: decision.requiredClosingPivot,
      recentExchanges: state.recentExchanges,
      forbiddenTopics: decision.forbiddenTopics,
    });
  }
  if (decision.responseMode === "guided_gpt" && decision.baseAnswer && state.context) {
    return buildConversationalRebuttalInstruction(state.context, decision.baseAnswer, {
      closingPivot: decision.requiredClosingPivot,
    });
  }
  if (decision.lineToSay) return buildExactScriptLineInstruction(decision.lineToSay, {});
  return buildExactScriptLineInstruction(getStateAwareClosingPivot(state), {});
}

function maybeFireServerSideBookingTrigger(state: CallState): void {
  try {
    const newStepIdx = Number(state.scriptStepIndex || 0);
    const totalSteps = (state.scriptSteps || []).length;
    const onConfirmStep = newStepIdx >= 3 && totalSteps >= 4;
    const lastExactTime = String((state as any).lastExactTimeText || "").trim();
    const lastExactAt = Number((state as any).lastExactTimeAtMs || 0);
    const hasRecentExactTime =
      !!lastExactTime &&
      isExactClockTimeMentioned(lastExactTime) &&
      lastExactAt > 0 &&
      (Date.now() - lastExactAt) < 5 * 60 * 1000;

    if (!onConfirmStep || !hasRecentExactTime || state.finalOutcomeSent) return;

    console.log("[AI-VOICE][BOOKING][SERVER-TRIGGER][POLICY]", {
      callSid: state.callSid,
      stepIndex: newStepIdx,
      lastExactTimeText: lastExactTime,
    });
    void handleFinalOutcomeIntent(state, {
      kind: "final_outcome",
      outcome: "booked",
      summary: `AI scheduled appointment. Lead confirmed call around ${lastExactTime}.`,
      notesAppend: `Approximate time confirmed by lead: ${lastExactTime}. Agent should confirm exact slot.`,
    });
    state.finalOutcomeSent = true;

    try {
      const agentTz = String(state.context?.agentTimeZone || "America/Phoenix").trim();
      const leadTz = String(getLeadTimeZoneHintFromContext(state.context!) || agentTz).trim();
      const nowInAgentTz = new Date().toLocaleString("en-US", { timeZone: agentTz });
      const explicitDay =
        extractExplicitDaySelection(lastExactTime) ||
        extractExplicitDaySelection(String(state.selectedTimeText || "")) ||
        extractExplicitDaySelection(String(state.lastAcceptedUserText || ""));
      const rememberedDay = String(state.selectedDay || "").trim().toLowerCase();
      const selectedBookingDay =
        explicitDay === "today" || explicitDay === "tomorrow"
          ? explicitDay
          : rememberedDay === "today" || rememberedDay === "tomorrow"
            ? rememberedDay
            : "today";
      const bookingLocalDate = new Date(nowInAgentTz);
      if (selectedBookingDay === "tomorrow") bookingLocalDate.setDate(bookingLocalDate.getDate() + 1);
      const bookingDateStr = bookingLocalDate.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });

      const extractSpokenClockForBooking = (raw: string): string => {
        const t2 = String(raw || "").trim().toLowerCase();
        const meridiem = t2.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
        if (meridiem) return `${meridiem[1]}${meridiem[2] ? `:${meridiem[2]}` : ""}${meridiem[3]}`;
        const clock = t2.match(/\b(\d{1,2}:\d{2})\b/);
        if (clock) return clock[1];
        const atBare = t2.match(/\b(?:at|around|about|by)\s+(\d{1,2})\b/i);
        if (atBare) return atBare[1];
        return String(raw || "").trim();
      };

      const parseSpokenTime = (raw: string, dateStr: string, tz: string): Date | null => {
        try {
          const t2 = raw.trim().toLowerCase();
          const match = t2.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
          if (!match) return null;
          let hh = Number(match[1]);
          const mm = Number(match[2] || "0");
          const mer = (match[3] || "").toLowerCase();
          if (mer === "pm" && hh !== 12) hh += 12;
          if (mer === "am" && hh === 12) hh = 0;
          if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
          const [mo, da, yr] = dateStr.split("/").map(Number);
          if (!mo || !da || !yr) return null;
          const localIso = `${yr}-${String(mo).padStart(2,"0")}-${String(da).padStart(2,"0")}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00`;
          const approxUtc = new Date(localIso + "Z");
          const tzParts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(approxUtc);
          const tzH = Number(tzParts.find(p => p.type === "hour")?.value || 0);
          const tzM = Number(tzParts.find(p => p.type === "minute")?.value || 0);
          const diffMinutes = (hh * 60 + mm) - (tzH * 60 + tzM);
          const result = new Date(approxUtc.getTime() + diffMinutes * 60 * 1000);
          return isNaN(result.getTime()) ? null : result;
        } catch { return null; }
      };

      const timeTextForBooking = extractSpokenClockForBooking(lastExactTime);
      const startDate = parseSpokenTime(timeTextForBooking, bookingDateStr, agentTz);
      if (startDate && !isNaN(startDate.getTime())) {
        const diffMs = startDate.getTime() - Date.now();
        if (diffMs > -60000 && diffMs < 48 * 60 * 60 * 1000) {
          void handleBookAppointmentIntent(state, {
            startTimeUtc: startDate.toISOString(),
            durationMinutes: 30,
            leadTimeZone: isValidIanaTimeZone(leadTz) ? leadTz : agentTz,
            agentTimeZone: isValidIanaTimeZone(agentTz) ? agentTz : "America/Phoenix",
            notes: `Booked via AI Dialer. Lead said: "${lastExactTime}". Agent should confirm exact slot.`,
          });
        }
      }
    } catch (bookErr: any) {
      console.warn("[AI-VOICE][BOOKING][POLICY-TRIGGER] calendar error (non-blocking):", bookErr?.message);
    }
  } catch {}
}

async function handleConversationTurn(
  state: CallState,
  lastUserText: string,
  source: "main" | "replay",
  stepCtx: { idx: number; steps: string[]; stepType: StepType; expectedAnswerIdx: number },
  turnKey: string,
  humanPause: () => Promise<void>
): Promise<boolean> {
  const text = String(lastUserText || "").trim();
  if (!text) return false;

  const intent = classifyTurnIntent(text, state, stepCtx);
  const decision = buildConversationPolicyDecision(intent, state, stepCtx);
  if (!decision.handled) return false;
  if (!markCommittedTurnHandled(state, turnKey, `${source} policy`)) return true;

  let lineToSay = decision.lineToSay || getStateAwareClosingPivot(state);
  let routeKindForMemory = decision.routeKind;
  let objectiveForMemory = decision.objective;
  let repeatGuardStateWrites: Record<string, unknown> = {};
  let repeatGuard: ReturnType<typeof applyAiOutputRepeatGuard> | null = null;
  if (decision.responseMode !== "free_response") {
    repeatGuard = applyAiOutputRepeatGuard(state, lineToSay, {
      userText: text,
      routeKind: decision.routeKind,
      objective: decision.objective,
    });
    lineToSay = repeatGuard.lineToSay;
    routeKindForMemory = repeatGuard.routeKind;
    objectiveForMemory = repeatGuard.objective;
    decision.lineToSay = lineToSay;
    repeatGuardStateWrites = repeatGuard.stateWrites;
    if (repeatGuard.suppressed) {
      decision.responseMode = "exact_script";
      decision.baseAnswer = undefined;
      decision.requiredClosingPivot = lineToSay;
    }
  }
  // If the repeat guard suppressed the line AND we have user text that
  // looks like a real question or confusion, route to free_response
  // instead of exact_script so GPT can handle it naturally.
  if (
    repeatGuard?.suppressed &&
    decision.responseMode === "exact_script" &&
    state.context &&
    text.length > 3
  ) {
    const currentStepLine = (state.scriptSteps || [])[
      state.awaitingAnswerForStepIndex ?? stepCtx.idx ?? 0
    ] || "";
    if (currentStepLine.trim()) {
      decision.responseMode = "free_response";
      decision.userText = text;
      decision.requiredClosingPivot = currentStepLine.trim();
    }
  }
  // Ensure free_response always knows the current required step
  if (decision.responseMode === "free_response" && state.context) {
    const currentStepLine = (state.scriptSteps || [])[
      state.awaitingAnswerForStepIndex ?? stepCtx.idx ?? 0
    ] || "";
    decision.requiredClosingPivot = currentStepLine.trim() || decision.requiredClosingPivot;
  }
  const instr = buildResponseFromPolicy(decision, state, stepCtx);

  for (const [k, v] of Object.entries(decision.stateWrites)) {
    (state as any)[k] = v;
  }
  for (const [k, v] of Object.entries(repeatGuardStateWrites)) {
    (state as any)[k] = v;
  }

  if (decision.shouldAdvanceStep) {
    maybeFireServerSideBookingTrigger(state);
  }

  pushExchange(state, "user", text, stepCtx.expectedAnswerIdx);
  pushExchange(state, "ai", lineToSay, stepCtx.expectedAnswerIdx);

  if (!("awaitingUserAnswer" in decision.stateWrites)) {
    state.awaitingUserAnswer = false;
    state.awaitingAnswerForStepIndex = undefined;
  }

  state.userAudioMsBuffered = 0;
  state.lastUserTranscript = "";
  state.lowSignalCommitCount = 0;
  state.repromptCountForCurrentStep = 0;

  await humanPause();
  setWaitingForResponse(state, true, "response.create (policy)");
  setAiSpeaking(state, true, "response.create (policy)");
  setResponseInFlight(state, true, "response.create (policy)");
  state.outboundOpenAiDone = false;
  state.lastPromptSentAtMs = Date.now();
  state.lastPromptLine = lineToSay;
  state.lastResponseCreateAtMs = Date.now();

  recordPassiveRouteMemory(state, {
    source,
    routeKind: routeKindForMemory,
    routeReason: objectiveForMemory || intent.kind + ((intent.subKind && intent.subKind !== intent.kind) ? `:${intent.subKind}` : ""),
    userText: text,
    lineToSay,
    turnKey,
  });
  noteAiOutputSpoken(state, lineToSay);

  state.openAiWs?.send(JSON.stringify(buildRealtimeResponseCreate(instr, { temperature: 0.6 })));

  if (!("awaitingUserAnswer" in decision.stateWrites)) {
    state.awaitingUserAnswer = !decision.shouldAdvanceStep;
    state.awaitingAnswerForStepIndex = decision.shouldAdvanceStep ? undefined : stepCtx.expectedAnswerIdx;
  }

  if (!("phase" in decision.stateWrites)) {
    state.phase = "in_call";
  }

  return true;
}

// ── End Policy Layer ───────────────────────────────────────────────────────────

/**
 * ✅ Build per-turn instruction that makes drift basically impossible.
 * We do NOT change audio/timers/turn detection. Only the "text instructions" for response.create.
 */

/**
 * Conversational rebuttal instruction (GPT-like but BOOKING-ONLY)
 * Used ONLY for objections/micro-intents, NOT for deterministic script steps.
 *
 * Goals:
 * - Allow a short, natural 1–2 sentence answer to the user's immediate question/concern
 * - Immediately pivot back to scheduling
 * - End with a booking question (later today vs tomorrow + daytime/evening)
 *
 * Hard constraints:
 * - Not licensed; no underwriting/discovery (no age/DOB, coverage amounts, mortgage balance, health, meds, quotes, pricing)
 * - No mentioning prompts/scripts/system
 * - No repetitive verbatim loops; rephrase if you just said the same thing
 */
/**
 * ── Free-response fallback ──
 * Used when the lead says something we don't recognise as an objection, a real time answer,
 * or a question — but we still need to respond rather than go silent.
 * Hard rules apply. Always steers back to booking. No discovery. No underwriting.
 */
function buildFreeResponseInstruction(
  ctx: AICallContext,
  opts: {
    userText: string;
    recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
    currentStepLine?: string;
    stepType?: string;  // helps GPT know what kind of answer to steer toward
  }
): string {
  const leadName = (ctx.clientFirstName || "").trim() || "there";
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();
  const closeQuestion = getScriptCloseQuestion(ctx);

  // Kayla demo calls get a separate instruction set — no insurance framing, no licensed-agent
  // language, full freedom to discuss CoveCRM product.
  if (normalizeScriptKey(ctx?.scriptKey) === "kayla_signup") {
    const userText = String(opts.userText || "").trim();
    const exchanges = opts.recentExchanges || [];
    let historyBlock = "";
    if (exchanges.length > 0) {
      const lines = exchanges.slice(-3).map(e => {
        const who = e.role === "ai" ? "You said" : "Lead said";
        return `  ${who}: "${e.text}"`;
      });
      historyBlock = `\nRECENT CONVERSATION:\n${lines.join("\n")}\n`;
    }
    return `
You are ${(ctx.voiceProfile?.aiName || "Kayla").trim()}, the CoveCRM AI on a live demo call. This call IS the demo — how you handle it is exactly what their leads would experience.

YOUR JOB:
- Answer any CoveCRM product question accurately and conversationally.
- Handle objections with genuine push-back, not canned lines.
- Steer toward offering the signup code or booking a deeper demo call with ${agent}.
- Sound like a real person — warm, direct, knowledgeable.

HARD RULES:
- English only.
- Never guarantee specific lead costs or sales results.
- Never reveal competitor pricing or make up stats.
- If asked about pricing: "$199.99/month flat, all features included. COVE50 code saves $50 off the first month. 7-day free trial."
- After you speak, stop and wait. Do not fill silence.
- NEVER apologize. Never say "I'm sorry", "I apologize", "I missed that". Re-engage naturally instead.
- Never ask two questions in one turn.
${historyBlock}
WHAT THE LEAD JUST SAID:
"${userText}"

YOUR JOB:
1. Acknowledge what they said in one short sentence — warm and direct.
2. Answer their question or handle their objection genuinely, using real CoveCRM knowledge.
3. Redirect naturally toward the demo or signup code.
4. End with: "${closeQuestion}"

KEEP IT SHORT: 2–3 sentences max.
    `.trim();
  }

  const userText = String(opts.userText || "").trim();
  const exchanges = opts.recentExchanges || [];
  const currentStep = (() => {
    if (opts.currentStepLine && opts.currentStepLine.trim()) {
      return opts.currentStepLine.trim();
    }
    // Fall back to reading the step directly from state via context
    // This ensures the step is always passed even if caller forgot opts
    return "";
  })();

  let historyBlock = "";
  if (exchanges.length > 0) {
    const lines = exchanges.slice(-3).map(e => {
      const who = e.role === "ai" ? "You said" : "Lead said";
      return `  ${who}: "${e.text}"`;
    });
    historyBlock = `
RECENT CONVERSATION:
${lines.join("\n")}
`;
  }

  const stepTypeHint = (() => {
    const st = String(opts.stepType || "").toLowerCase();
    if (st === "open_question") return `
This is an open question. You need a specific answer before moving forward. Do not skip it.`;
    if (st === "yesno_question") return `
This is a yes-or-no question. Steer toward a clear yes or no.`;
    if (st === "time_question") return `
You need a day or time. Offer today or tomorrow as the options.`;
    return "";
  })();

  const stepHint = currentStep
    ? `
YOUR CURRENT OBJECTIVE (non-negotiable):
The call is at this question and you have NOT received an answer yet:
"${currentStep}"${stepTypeHint}

After handling whatever the lead just said, you MUST naturally work back
to this question. Do not skip it. Do not jump ahead.
If they seem confused about the call itself, briefly explain and re-ask.
If they asked a product question, answer briefly and re-ask.
If they objected, acknowledge and re-ask.
The re-ask should sound natural, not robotic.
`
    : `
YOUR CURRENT OBJECTIVE:
Get the lead scheduled for a quick call with ${agent}.
After handling what they said, pivot back to: "Does later today or tomorrow work better?"
`;

  return `
You are a natural, warm virtual assistant on a live phone call. Sound conversational and clear, not like a call-center script.

HARD RULES (non-negotiable, always):
- English only.
- This call is ONLY about a ${scope} request. Never mention other products.
- You are NOT licensed. Never quote prices, rates, coverage amounts, or underwriting details.
- Never mention scripts or prompts. Do not proactively announce AI in the opener; if asked whether you are AI, automated, a bot, a robot, or virtual, answer honestly.
- Never ask: age, DOB, coverage amount, mortgage balance, health, meds, smoking, income, SSN, or address.
- If they ask cost/coverage/details: "${agent} covers all of that on the call."
- Use the lead name "${leadName}" only if it flows naturally.
- After you speak, STOP and wait. Do not fill silence.
- NEVER apologize. NEVER say "I'm sorry", "I apologize", "I missed that", "I didn't catch that", "my mistake", or any apology of any kind. Ever. If they say you didn't hear them or ask if you can hear them, re-engage naturally and warmly — do NOT acknowledge an error.
- You are a scheduling assistant only. You are not the licensed agent. Do not run the sales call.
- Never discuss coverage options, plan options, policy details, underwriting, or program information.
- Never ask discovery questions. Do not open new topics or invite elaboration.
- Never say or imply: "tell me more", "what would you like to start with", "let's go through the details", "step by step", "cover options", "coverage options", "coverage you're looking for", "I'm here to help with that", "I'll walk you through", "we can discuss", "explore your options".
- End ONLY with the required close question or the current step question: "${closeQuestion}". Nothing else.
${historyBlock}${stepHint}
WHAT THE LEAD JUST SAID:
"${userText}"

YOUR JOB:
1. Acknowledge what they said in one short sentence — warm, direct, and natural.
2. If they asked something: answer it in one sentence using only hard-rule-safe information.
3. Immediately redirect to the current scheduling objective. Do not linger on their topic.
4. End with the required closing question above. Do not deviate from it.

	KEEP IT SHORT: 2–3 sentences max. No speeches. No over-explaining.
	`.trim();
}

function buildPostCoverageControlledResponseInstruction(
  ctx: AICallContext,
  opts: {
    userText: string;
    baseAnswer: string;
    requiredClosingPivot: string;
    recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
    forbiddenTopics?: string[];
  }
): string {
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim() || agentRaw;
  const userText = String(opts.userText || "").trim();
  const baseAnswer = String(opts.baseAnswer || "").replace(/\s+/g, " ").trim();
  const requiredClosingPivot = String(opts.requiredClosingPivot || "").replace(/\s+/g, " ").trim();
  const forbiddenTopics = (opts.forbiddenTopics || []).filter(Boolean);
  const exchanges = opts.recentExchanges || [];

  let historyBlock = "";
  if (exchanges.length > 0) {
    const lines = exchanges.slice(-3).map(e => {
      const who = e.role === "ai" ? "You said" : "Lead said";
      return `  ${who}: "${String(e.text || "").replace(/\s+/g, " ").trim()}"`;
    });
    historyBlock = `
RECENT CONVERSATION (context only; do NOT repeat yourself):
${lines.join("\n")}
`;
  }

  const forbiddenBlock = forbiddenTopics.length
    ? `
FORBIDDEN TOPICS FOR THIS TURN:
${forbiddenTopics.map(t => `- ${t}`).join("\n")}
`
    : "";

  return `
You are a natural, calm scheduling assistant on a live phone call.

STRICT POST-COVERAGE RESPONSE CONTRACT:
- Say exactly 2 sentences maximum.
- Sentence 1: acknowledge the caller naturally and answer ONLY their current concern using the BASE ANSWER.
- Sentence 2: MUST include this exact required closing pivot, word-for-word:
"${requiredClosingPivot}"
- Do not ask discovery questions.
- Do not say "tell me more".
- Do not quote prices, rates, coverage amounts, underwriting, program specifics, or policy details.
- Do not give third-party advice or tell them to research elsewhere.
- Do not ramble, explain the product, or change the objective.
- Do not invent facts.
- Do not repeat a previous prompt unless the caller clearly asked you to repeat.
- Sound natural, brief, and confident, not canned.
- If the caller mentioned a day, time, or time window, respect it and use the required closing pivot exactly.

CALL CONTEXT:
- This is about a ${scope} request.
- ${agent} is the licensed agent who can answer specifics on the call.
${historyBlock}${forbiddenBlock}
WHAT THE CALLER JUST SAID:
"${userText}"

BASE ANSWER:
"${baseAnswer}"

Now respond with the 2-sentence contract above.
`.trim();
}

function buildConversationalRebuttalInstruction(
  ctx: AICallContext,
  baseLineToUse: string,
  opts?: {
    objectionKind?: string;
    userText?: string;
    lastOutboundLine?: string;
    lastOutboundAtMs?: number;
    repeatMode?: boolean;  // true when same objection fires 2nd+ time
    recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
    closingPivot?: string;
  }
): string {
  const leadName = (ctx.clientFirstName || "").trim() || "there";
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim() || agentRaw;
  const isKayla = normalizeScriptKey(ctx.scriptKey) === "kayla_signup";

  const baseLine = String(baseLineToUse || "").replace(/\s+/g, " ").trim();
  const userText = String(opts?.userText || "").trim();

  const lastLine = String(opts?.lastOutboundLine || "").replace(/\s+/g, " ").trim().toLowerCase();
  const lastAt = Number(opts?.lastOutboundAtMs || 0);
  const now = Date.now();
  const repeatMode = !!opts?.repeatMode;
  const exchanges = opts?.recentExchanges || [];

  const scriptClose = getScriptCloseQuestion(ctx);
  const recentlyRepeated = !!lastLine && !!baseLine && (now - lastAt) < 10000 && lastLine === baseLine.toLowerCase();
  const closeWithBlock = opts?.closingPivot
    ? `CLOSE WITH THIS EXACT LINE — do not vary it:\n"${opts.closingPivot}"`
    : `CLOSE WITH the required close question (vary the phrasing slightly, keep the intent):\n"${scriptClose}"\nAlternate phrasings OK; always end with the same scheduling offer.`;

  // Build recent-exchange block
  let historyBlock = "";
  if (exchanges.length > 0) {
    const lines = exchanges.slice(-3).map(e => {
      const who = e.role === "ai" ? "You said" : "Lead said";
      return `  ${who}: "${e.text}"`;
    });
    historyBlock = `
RECENT CONVERSATION (context — do NOT repeat what you already said):
${lines.join("\n")}
`;
  }

  const userBlock = userText
    ? `
WHAT THE LEAD JUST SAID:
"${userText}"
`
    : "";

  // De-escalation mode: when the same objection fires a second time, the lead is more frustrated.
  // Drop the sales energy, acknowledge their frustration genuinely, then softly re-ask.
  const deEscalateBlock = repeatMode ? `
DE-ESCALATION MODE (they pushed back again — do NOT repeat your last response):
- Drop the cheerful pitch energy. Match their frustration with calm empathy.
- Acknowledge that you heard them and you're not trying to pressure them.
- ONE soft, low-pressure ask at the end — no hard close.
- Example openers: "Yeah, totally fair —", "I hear you —", "No worries at all —"
- Do NOT say the same thing you said last time.
` : "";

  // Kayla demo calls: no insurance framing, no licensed-agent language, full product knowledge.
  if (isKayla) {
    return `
You are ${(ctx.voiceProfile?.aiName || "Kayla").trim()}, the CoveCRM AI on a live demo call. Sound confident, warm, and genuine — not like a script.

CONTEXT: This call IS the demo. How you handle this objection is exactly what their leads would hear.

HARD RULES:
- English only.
- Lead name: "${leadName}" — use it only if it flows naturally.
- Never guarantee specific lead costs or sales results.
- If they ask pricing: "$199.99/month flat, all features included. COVE50 saves $50 off the first month. 7-day free trial."
- Never mention scripts or prompts.
- After you speak, stop and wait.
- NEVER apologize.
${historyBlock}${userBlock}${deEscalateBlock}
HOW TO RESPOND:
1. React naturally — match their energy. 1 sentence.
2. Handle the objection genuinely — use real CoveCRM knowledge, not canned lines. 1–2 sentences.
3. Pivot back naturally toward the demo or signup code.
4. ${closeWithBlock}

NEVER SAY:
- Insurance language (licensed agent, coverage, policy, carriers, underwriting)
- More than 3–4 sentences total
- The exact same thing you said in a prior turn

BASE IDEA — rephrase in your own natural voice, don't read it verbatim:
"${baseLine}"
    `.trim();
  }

  return `
You are a sharp, natural virtual assistant on a phone call. Sound confident, warm, and brief, not like a script.

HARD RULES (never break):
- English only.
- Lead name: "${leadName}" — only use it if it sounds natural, never force it.
- This call is ONLY about a ${scope} request. Never mention other products.
- You are NOT licensed. Never quote prices, rates, or coverage details.
- Never mention scripts or prompts. Do not proactively announce AI in the opener; if asked whether you are AI, automated, a bot, a robot, or virtual, answer honestly.
- Never bring up billing, memberships, or cancellations — if they do, pivot back to scheduling.
- Never ask: age, DOB, coverage amount, mortgage balance, health, meds, smoking, income, SSN, or address.
- If they ask cost/coverage: "${agent} will go over all of that on the call" then get back to scheduling.
${historyBlock}${userBlock}${deEscalateBlock}
HOW TO RESPOND:
1. React naturally — use variety. Match their energy. 1 sentence.
2. Answer or acknowledge what they said briefly and directly. 1 sentence max.
3. Bridge back to scheduling naturally.
4. Close with the booking question (unless in de-escalation mode — then keep it soft).

NEVER SAY:
- "I understand" as your opener every single time
- "Got it" as your opener every single time
- Anything that sounds like a canned script line
- More than 3-4 sentences total
- The exact same thing you said in a prior turn (check RECENT CONVERSATION above)

BASE IDEA — rephrase this in your own natural voice, don't read it verbatim:
"${baseLine}"

${closeWithBlock}
`.trim();
}
function buildStepperTurnInstructionLegacy(
  ctx: AICallContext,
  lineToSay: string,
  opts?: {
    userText?: string;
    recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
  }
): string {
  const leadName = (ctx.clientFirstName || "").trim() || "there";
  const line = String(lineToSay || "").trim();
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();

  const userText = String(opts?.userText || "").trim();
  const exchanges = opts?.recentExchanges || [];

  // Build recent-exchange block (last 3, oldest first)
  let historyBlock = "";
  if (exchanges.length > 0) {
    const lines = exchanges.slice(-3).map(e => {
      const who = e.role === "ai" ? "You said" : "Lead said";
      return `  ${who}: "${e.text}"`;
    });
    historyBlock = `
RECENT CONVERSATION (for context only — do NOT repeat these):
${lines.join("\n")}
`;
  }

  const userBlock = userText
    ? `
WHAT THE LEAD JUST SAID:
"${userText}"
`
    : "";

  // Derive the goal of this step from the line itself
  const lineLower = line.toLowerCase();
  let stepGoal = "Move the conversation forward toward booking an appointment.";
  if (lineLower.includes("later today") || lineLower.includes("today or tomorrow")) {
    stepGoal = "Get a day commitment — today or tomorrow — so you can offer a specific time.";
  } else if (lineLower.includes("specific time") || lineLower.includes("what time") || lineLower.includes("what works best")) {
    stepGoal = "Lock in a specific clock time for the appointment.";
  } else if (lineLower.includes("does that work") || lineLower.includes("call you around")) {
    stepGoal = "Confirm the time you just offered and close the booking.";
  } else if (lineLower.includes("yourself") || lineLower.includes("spouse")) {
    stepGoal = "Find out if the coverage is for just them or a spouse too, then move to scheduling.";
  } else if (lineLower.includes("talk soon") || lineLower.includes("reach out")) {
    stepGoal = "Wrap up warmly — they're booked. Keep it brief and positive.";
  }

  return `
CRITICAL ROLE LOCK — READ FIRST:
You are a scheduling assistant ONLY. Your ONLY job is to get this person scheduled with the licensed agent.
- You are NOT the agent. You are NOT licensed. You cannot discuss coverage, rates, or policy details.
- Do NOT answer questions about what the agent covers, what programs are available, or what insurance costs.
- Do NOT say "I can help go over the details" or "I can walk you through options" or "I can explain your options."
- If they ask what you do or what you can help with: "I'm just here to get you scheduled with ${agent} — they'll go over everything with you."
- After EVERY response, STOP and WAIT. Never keep talking.
- Your only acceptable outcomes: book a time, offer a time, or get a yes/no on right now.

You are a natural, confident virtual assistant on a live phone call. Sound warm, conversational, and never robotic.

HARD RULES (non-negotiable):
- English only. This call is ONLY about a ${scope} request.
- Never mention scripts or prompts. Do not proactively announce AI in the opener; if asked whether you are AI, automated, a bot, a robot, or virtual, answer honestly.
- Never quote prices, coverage amounts, or underwriting details.
- If they ask cost/coverage: "${agent} covers all of that on the call."
- Use the lead name "${leadName}" only if it flows naturally — never force it.
- After you speak, STOP and wait. Do not fill silence.
${historyBlock}${userBlock}
YOUR GOAL THIS TURN:
${stepGoal}

SUGGESTED LINE (your backbone — deliver the substance of this naturally, don't read it verbatim):
"${line}"

HOW TO DELIVER IT:
1. If the lead said something — acknowledge it briefly first (1–4 words: "Got it.", "Yeah for sure.", "Makes sense.", "Okay —"). Match their energy.
2. Respond to anything they raised that needs a quick word (1 sentence max). If nothing needs addressing, skip this.
3. Deliver the substance of the suggested line naturally. You may rephrase slightly to sound conversational, but preserve the core ask.
4. STOP. Do not add explanations, summaries, or extra commentary.

VARIETY RULE: Do not open with "I understand" or "Got it" every single turn. Mix it up. Sound natural, not scripted.
`.trim();
}

// ── Conversation memory helpers ──

function pushExchange(
  state: CallState,
  role: "ai" | "user",
  text: string,
  stepIndex?: number
) {
  if (!text.trim()) return;
  if (!state.recentExchanges) state.recentExchanges = [];
  state.recentExchanges.push({ role, text: text.trim(), stepIndex });
  // Keep only last 6 entries (3 full exchanges)
  if (state.recentExchanges.length > 6) {
    state.recentExchanges = state.recentExchanges.slice(-6);
  }
}

function buildStepperTurnInstruction(ctx: any, arg2: any, opts?: {
  userText?: string;
  recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
}): string {
  const line = String(arg2 || "").trim();
  return buildStepperTurnInstructionLegacy(ctx, line, opts);
}



function getCurrentStepperLine(state: CallState): { idx: number; line: string } {
  const idx =
    typeof state.scriptStepIndex === "number" ? state.scriptStepIndex : 0;
  const steps = state.scriptSteps || [];
  const safeIdx = Math.max(0, Math.min(idx, Math.max(0, steps.length - 1)));
  const line = String(steps[safeIdx] || "").trim();
  return { idx: safeIdx, line };
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
  const scope = getScopeLabelForScriptKey(scriptKey);
  const isKaylaSignupLead =
    normalizeScriptKey(ctx?.scriptKey) === "kayla_signup";

  if (isKaylaSignupLead) {
    return getKaylaSignupScript({
      aiName,
      clientFirstName: ctx?.clientFirstName,
      agentName: ctx?.agentName,
    });
  }

  const SCRIPT_MORTGAGE = `
BOOKING SCRIPT — MORTGAGE PROTECTION (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for mortgage protection. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Got it — I just need to get you scheduled for a quick call with ${agent} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?"
STOP. WAIT.

STEP 3 (TIME)
Then ask: "Perfect — is there a specific time you're available, or what works best for you?"
STOP. WAIT.

STEP 4 (CONFIRM)
Say: "Got it. I’ll have ${agent} call you around then. Does that work?"
STOP. WAIT.

STEP 5 (CLOSE)
Say: "Perfect. I’ll have ${agent} reach out around that time. Talk soon."
STOP. WAIT.
`.trim();

  const SCRIPT_FINAL_EXPENSE = `
BOOKING SCRIPT — FINAL EXPENSE (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for final expense coverage. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Got it — I just need to get you scheduled for a quick call with ${agent} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?"
STOP. WAIT.

STEP 3 (TIME)
Then ask: "Perfect — is there a specific time you're available, or what works best for you?"
STOP. WAIT.

STEP 4 (CONFIRM)
Say: "Got it. I’ll have ${agent} call you around then. Does that work?"
STOP. WAIT.

STEP 5 (CLOSE)
Say: "Perfect. I’ll have ${agent} reach out around that time. Talk soon."
STOP. WAIT.
`.trim();

  const SCRIPT_IUL = `
BOOKING SCRIPT — CASH VALUE / IUL (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for cash value life insurance — the IUL options. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Got it — I just need to get you scheduled for a quick call with ${agent} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?"
STOP. WAIT.

STEP 3 (TIME)
Then ask: "Perfect — is there a specific time you're available, or what works best for you?"
STOP. WAIT.

STEP 4 (CONFIRM)
Say: "Got it. I’ll have ${agent} call you around then. Does that work?"
STOP. WAIT.

STEP 5 (CLOSE)
Say: "Perfect. I’ll have ${agent} reach out around that time. Talk soon."
STOP. WAIT.
`.trim();

  const SCRIPT_VETERAN = `
BOOKING SCRIPT — VETERAN LEADS (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for the veteran life insurance programs. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Got it — I just need to get you scheduled for a quick call with ${agent} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?"
STOP. WAIT.

STEP 3 (TIME)
Then ask: "Perfect — is there a specific time you're available, or what works best for you?"
STOP. WAIT.

STEP 4 (CONFIRM)
Say: "Got it. I’ll have ${agent} call you around then. Does that work?"
STOP. WAIT.

STEP 5 (CLOSE)
Say: "Perfect. I’ll have ${agent} reach out around that time. Talk soon."
STOP. WAIT.
`.trim();

  const SCRIPT_TRUCKER = `
BOOKING SCRIPT — TRUCKER LEADS (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for life insurance for truckers. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Got it — I just need to get you scheduled for a quick call with ${agent} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?"
STOP. WAIT.

STEP 3 (TIME)
Then ask: "Perfect — is there a specific time you're available, or what works best for you?"
STOP. WAIT.

STEP 4 (CONFIRM)
Say: "Got it. I’ll have ${agent} call you around then. Does that work?"
STOP. WAIT.

STEP 5 (CLOSE)
Say: "Perfect. I’ll have ${agent} reach out around that time. Talk soon."
STOP. WAIT.
`.trim();

  const SCRIPT_VETERAN_IUL = `
BOOKING SCRIPT — VETERAN IUL (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for the veteran IUL program — the tax-free life insurance benefit for veterans. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Got it — I just need to get you scheduled for a quick call with ${agent} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?"
STOP. WAIT.

STEP 3 (TIME)
Then ask: "Perfect — is there a specific time you're available, or what works best for you?"
STOP. WAIT.

STEP 4 (CONFIRM)
Say: "Got it. I'll have ${agent} call you around then. Does that work?"
STOP. WAIT.

STEP 5 (CLOSE)
Say: "Perfect. I'll have ${agent} reach out around that time. Talk soon."
STOP. WAIT.
`.trim();

  const SCRIPT_VETERAN_MORTGAGE = `
BOOKING SCRIPT — VETERAN MORTGAGE PROTECTION (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for mortgage protection for veterans. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Got it — I just need to get you scheduled for a quick call with ${agent} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?"
STOP. WAIT.

STEP 3 (TIME)
Then ask: "Perfect — is there a specific time you're available, or what works best for you?"
STOP. WAIT.

STEP 4 (CONFIRM)
Say: "Got it. I'll have ${agent} call you around then. Does that work?"
STOP. WAIT.

STEP 5 (CLOSE)
Say: "Perfect. I'll have ${agent} reach out around that time. Talk soon."
STOP. WAIT.
`.trim();

  const SCRIPT_TRUCKER_IUL = `
BOOKING SCRIPT — TRUCKER IUL (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for the IUL program for truckers — the tax-free cash value coverage built for your lifestyle. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Got it — I just need to get you scheduled for a quick call with ${agent} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?"
STOP. WAIT.

STEP 3 (TIME)
Then ask: "Perfect — is there a specific time you're available, or what works best for you?"
STOP. WAIT.

STEP 4 (CONFIRM)
Say: "Got it. I'll have ${agent} call you around then. Does that work?"
STOP. WAIT.

STEP 5 (CLOSE)
Say: "Perfect. I'll have ${agent} reach out around that time. Talk soon."
STOP. WAIT.
`.trim();

  const SCRIPT_TRUCKER_MORTGAGE = `
BOOKING SCRIPT — TRUCKER MORTGAGE PROTECTION (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for mortgage protection for truckers. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Got it — I just need to get you scheduled for a quick call with ${agent} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?"
STOP. WAIT.

STEP 3 (TIME)
Then ask: "Perfect — is there a specific time you're available, or what works best for you?"
STOP. WAIT.

STEP 4 (CONFIRM)
Say: "Got it. I'll have ${agent} call you around then. Does that work?"
STOP. WAIT.

STEP 5 (CLOSE)
Say: "Perfect. I'll have ${agent} reach out around that time. Talk soon."
STOP. WAIT.
`.trim();

  const SCRIPT_GENERIC = `
BOOKING SCRIPT — GENERIC LIFE (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for life insurance. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Got it — I just need to get you scheduled for a quick call with ${agent} so they can answer everything. Does later today or tomorrow work better, or did you want me to try to get them on the line right now?"
STOP. WAIT.

STEP 3 (TIME)
Then ask: "Perfect — is there a specific time you're available, or what works best for you?"
STOP. WAIT.

STEP 4 (CONFIRM)
Say: "Got it. I’ll have ${agent} call you around then. Does that work?"
STOP. WAIT.

STEP 5 (CLOSE)
Say: "Perfect. I’ll have ${agent} reach out around that time. Talk soon."
STOP. WAIT.
`.trim();

  if (scriptKey === "mortgage_protection") return SCRIPT_MORTGAGE;
  if (scriptKey === "final_expense") return SCRIPT_FINAL_EXPENSE;
  if (scriptKey === "iul_cash_value") return SCRIPT_IUL;
  if (scriptKey === "veteran_leads") return SCRIPT_VETERAN;
  if (scriptKey === "trucker_leads") return SCRIPT_TRUCKER;
  if (scriptKey === "veteran_iul") return SCRIPT_VETERAN_IUL;
  if (scriptKey === "veteran_mortgage") return SCRIPT_VETERAN_MORTGAGE;
  if (scriptKey === "trucker_iul") return SCRIPT_TRUCKER_IUL;
  if (scriptKey === "trucker_mortgage") return SCRIPT_TRUCKER_MORTGAGE;
  if (scriptKey === "generic_life") return SCRIPT_GENERIC;

  return SCRIPT_MORTGAGE;
}

/**
 * Rebuttals block — kept minimal. Objections/questions are handled by code policy in real time.
 * GPT never sees specific rebuttal scripts; it falls back to this only if code policy doesn’t fire.
 */
function getRebuttalsBlock(ctx: AICallContext): string {
  const scriptKey = normalizeScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();

  const COMMON = `
PRICING QUESTIONS
If asked how much it costs: "That's a great question — it really depends on what
you qualify for, how much coverage you want, and what fits your budget.
${agent} works with a lot of different companies and will find you the best rate.
I can't give you an exact number because I'm just the scheduling assistant,
but policies generally range from around $20 to $250 a month depending on
the coverage. ${agent} will go over everything on the call."

If pushed for a ballpark: give the $20-$250 range and redirect.
If asked for an exact quote: "I'm not a licensed agent so I can't quote that —
that's exactly what the call with ${agent} is for."

NO MEDICAL EXAM
If asked about medical exams: "Good news — there's no medical exam required
for most of what ${agent} goes over. It's mostly just a few health questions."

LIVING BENEFITS
If asked about getting paid out for illness or injury:
"A lot of these policies do come with living benefits — so if you ever get
diagnosed with a critical, chronic, or terminal illness, the coverage can
pay out upfront while you're still here. ${agent} will go over exactly
what applies to your situation."

GENERAL OBJECTIONS
If not interested: acknowledge genuinely, do not pressure, ask one soft question
about whether timing is the issue or something else, then offer to schedule anyway.
If busy: "Totally understand — ${agent} keeps it quick, usually under 10 minutes.
Does later today or tomorrow work better?"
If already have coverage: "That's great — a lot of people ${agent} works with
already have something in place but end up finding gaps or overpaying.
It's worth a quick look. Does later today or tomorrow work better?"
If skeptical/scam concern: "Completely fair — this is a state-regulated program
and ${agent} is a licensed agent. Everything gets explained clearly on the call.
Does later today or tomorrow work better?"

WHAT YOU ARE
You are a scheduling assistant. You are not a licensed agent.
You cannot give quotes, recommendations, or coverage advice.
Your only job is to get the appointment booked.
After answering any question — return naturally to scheduling.
Do not linger. One answer, then back on track.
`.trim();

  const VERTICAL: Record<string, string> = {
    mortgage_protection: `
WHAT IS MORTGAGE PROTECTION
If asked what it is: "Mortgage protection is a type of insurance that pays off
or pays down your house in the event of a death or disability — so if you pass
away, your family keeps the home."
If asked about getting sick or injured: "These policies do come with living
benefits — so depending on the policy, if you get sick or disabled,
it can pay out upfront while you're still here. ${agent} will go over
exactly what applies to your situation on the call."
Do NOT say mortgage protection pays your mortgage payments.
It pays OFF or DOWN the mortgage — there is a difference.
Stay away from calling it "life insurance" directly.
Term lengths and coverage amounts vary — ${agent} covers specifics on the call.
`,
    final_expense: `
WHAT IS FINAL EXPENSE
If asked: "Final expense coverage is designed to cover burial costs, medical bills,
and end-of-life expenses so your family isn't left with that burden."
Most policies are whole life — they don't expire and build cash value over time.
No medical exam required. Some policies are issued same day.
If asked about term vs whole life: "We work with both — ${agent} will find
what fits your situation and budget best."
`,
    iul_cash_value: `
WHAT IS AN IUL
If asked: "An IUL — indexed universal life — is a type of life insurance that
also builds cash value over time. A lot of people use it to grow money
tax-advantaged that they can borrow against later, while still having
the life insurance protection."
Good for people wanting: tax-free growth, retirement supplement, or
flexible premium life insurance with upside potential.
${agent} will go over exactly how it works and what you'd qualify for.
`,
    veteran_leads: `
VETERAN-SPECIFIC KNOWLEDGE
These programs are specifically designed to serve veterans and their families.
Many of the companies ${agent} works with offer veteran discounts —
${agent} will check exactly what you qualify for.
If asked "are you with the VA?": "We're not directly through the VA,
but the companies we work with do serve veterans specifically and
offer immediate coverage — no two-year waiting period like VA life insurance."
Immediate coverage. Veteran discounts available. ${agent} finds the best fit.
`,
    trucker_leads: `
TRUCKER-SPECIFIC KNOWLEDGE
These programs are built around the specific needs of truckers and their families.
Many carriers work directly with truckers and understand the occupational risk —
meaning better rates than standard life insurance for a lot of drivers.
If asked about coverage for on-the-road accidents: ${agent} covers what
applies to their specific situation.
Immediate coverage. Trucker-specific options. ${agent} finds the best fit.
`,
    veteran_iul: `
VETERAN IUL
IUL program specifically for veterans — combines life insurance protection
with cash value growth, designed around veteran needs and qualification.
Many carriers offer veteran discounts. Immediate coverage. No waiting period.
${agent} finds the best rate and highest cash value option available.
`,
    veteran_mortgage: `
VETERAN MORTGAGE PROTECTION
Mortgage protection specifically designed for veterans and their families.
Works similarly to standard mortgage protection but with veteran-specific
carriers and rates. Many offer veteran discounts.
Pays off or pays down the home in the event of death or disability.
Immediate coverage. No two-year waiting period.
`,
    trucker_iul: `
TRUCKER IUL
IUL program built for truckers — life insurance that grows cash value,
structured around trucker occupational needs.
Carriers that work directly with truckers often offer better rates.
${agent} finds the best rate and highest cash value available for truckers.
`,
    trucker_mortgage: `
TRUCKER MORTGAGE PROTECTION
Mortgage protection for truckers — pays off or pays down the home
in the event of death or disability, with trucker-specific carriers and rates.
Immediate coverage. Designed for the trucking lifestyle and occupation.
`,
    generic_life: `
LIFE INSURANCE — GENERAL
We work with all types: term, whole life, IUL, final expense, mortgage protection.
What fits best depends on what you qualify for and what your goal is.
${agent} works with multiple carriers to find the best rate and fit.
No medical exam for most options. Immediate coverage available.
`
  };

  const verticalKnowledge = VERTICAL[scriptKey] || VERTICAL["generic_life"];

  return `
VERTICAL KNOWLEDGE — USE THIS TO ANSWER PRODUCT QUESTIONS NATURALLY
${verticalKnowledge}

${COMMON}

HOW TO HANDLE ANY QUESTION
1. Answer it in 1-2 sentences using the knowledge above.
2. Do NOT say "the agent will cover that" for basic product questions
   you can answer from the knowledge above.
3. Do say "the agent covers specifics like exact pricing and qualification"
   for anything requiring a real quote or underwriting decision.
4. After answering — immediately return to scheduling naturally.
   One smooth sentence back to the booking question.
5. Never sound like you're reading a list. Sound like a prepared assistant
   who knows this stuff.
`.trim();
}

function getScriptBlock(ctx: AICallContext): string {
  const aiName = (ctx.voiceProfile.aiName || "Alex").trim() || "Alex";
  const clientRaw = (ctx.clientFirstName || "").trim();
  const client = clientRaw ? clientRaw : "there";
  const scriptKey = normalizeScriptKey(ctx.scriptKey);
  const scope = getScopeLabelForScriptKey(scriptKey);
  const isKaylaLead =
    normalizeScriptKey(ctx?.scriptKey) === "kayla_signup";

  if (isKaylaLead) {
    return `
KAYLA CONVERSATION GUIDE

This is a public CoveCRM signup inquiry. The caller requested a live call to hear how the AI assistant works.

Your job:
- Answer questions naturally and clearly.
- Explain CoveCRM simply.
- Learn whether they need more leads, faster follow-up, fewer missed leads, or better CRM organization.
- Guide them toward signup if interested.
- Offer to text the private signup code after the call.

Conversation rules:
- Keep replies short and natural unless they ask for detail.
- Ask one useful question at a time.
- Do not slip into insurance policy booking mode.
- Do not discuss quotes, rates, underwriting, or policy advice.
- If they ask random test questions, answer briefly and redirect back to how CoveCRM helps.
`.trim();
  }

  const HARD_LOCKS = `
TONE & DELIVERY (CRITICAL — READ FIRST)
- Sound like a warm, prepared assistant — not stiff or scripted.
- Brief natural acknowledgments help the call feel conversational: “Sure”, “Of course”, “Got it”, “Yeah absolutely”, “No worries”.
- Mirror the lead: friendly → friendly, brief → brief, hesitant → slow down and stay warm.
- Never ramble. One acknowledgment, then the next script line.
- If confused: “No worries — real quick...” + one clear sentence. If annoyed/rushed: “I totally get that — this’ll be quick.”
- If silence: “Hello — can you hear me okay?” then wait.
- Keep every turn to 1–2 sentences. Tighter sounds more confident.

HARD ENGLISH LOCK (NON-NEGOTIABLE)
- Speak ONLY English.

HARD NAME LOCK (NON-NEGOTIABLE)
- The ONLY name you may use for the lead is exactly: “${client}”
- If the lead name is missing, use exactly: “there”
- NEVER invent or guess a name. NEVER use any other name.

HARD SCOPE LOCK (NON-NEGOTIABLE)
- This call is ONLY about the lead’s ${scope} request that the lead submitted.
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
  const clientNameRaw = (ctx.clientFirstName || "").trim();
  const clientName = (!clientNameRaw || isTestOrPlaceholderName(clientNameRaw)) ? "there" : clientNameRaw;
  const isKaylaLead =
    normalizeScriptKey(ctx?.scriptKey) === "kayla_signup";

  if (isKaylaLead) {
    return `
You are ${aiName}, a virtual assistant making a phone call. Sound warm, sharp, natural, and relaxed.

YOUR ONLY JOB RIGHT NOW:
Open with a short, friendly greeting in no more than 2 sentences.
- Introduce yourself as Kayla with CoveCRM.
- Mention they requested a live call to hear how the AI assistant works.
- Ask one simple, friendly question.

TARGET OPENING STYLE:
"Hey ${clientName}, it's ${aiName} with CoveCRM — how are you today? I saw you requested a live call to hear how the AI assistant works."

DELIVERY RULES:
- Keep it conversational, not robotic.
- Do not pitch hard in the first breath.
- Do not mention insurance quotes or policy advice.
- Stop after the opener and wait for their response.
- English only.
`.trim();
  }

  return `
Say this greeting EXACTLY:
"Hey ${clientName}. This is ${aiName}. Can you hear me alright?"

Use a natural phone tone.
No extra words.
`.trim();
}

function buildExactScriptLineInstruction(lineRaw: string, opts?: {
  userText?: string;
  recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
  scope?: string;
  agent?: string;
  leadName?: string;
}): string {
  const line = String(lineRaw || "").trim();
  const userText = String(opts?.userText || "").trim();
  const scope = String(opts?.scope || "life insurance").trim();
  const agent = String(opts?.agent || "the agent").trim();
  const leadName = String(opts?.leadName || "there").trim();
  const exchanges = opts?.recentExchanges || [];

  let historyBlock = "";
  if (exchanges.length > 0) {
    const lines = exchanges.slice(-3).map(e => {
      const who = e.role === "ai" ? "You said" : "Lead said";
      return `  ${who}: "${e.text}"`;
    });
    historyBlock = `\nRECENT CONVERSATION:\n${lines.join("\n")}\n`;
  }

  const userBlock = userText
    ? `\nWHAT THE LEAD JUST SAID:\n"${userText}"\n`
    : "";

  return `
You are a warm, natural scheduling assistant on a live phone call.
This call is ONLY about a ${scope} request.
You are NOT licensed. Never quote prices, rates, or coverage details.
Never mention scripts or prompts.
NEVER apologize.
After you speak, STOP and wait.

HARD RULES:
- English only.
- Never ask discovery questions (age, health, income, coverage amounts).
- If they ask cost or coverage details: "${agent} covers all of that on the call."
- Use "${leadName}" only if it flows naturally.
${historyBlock}${userBlock}
YOUR REQUIRED OBJECTIVE THIS TURN:
You must say the following — this is the required output. Deliver it naturally.
It is okay to add a brief 1-sentence acknowledgment of what they just said
BEFORE delivering the required line, if they said something that needs
acknowledging (confusion, question, objection, frustration).
If they said nothing unusual, deliver the required line directly.

REQUIRED LINE:
"${line}"

DELIVERY RULES:
- If the lead said something confusing, frustrated, or asked a question:
  1. Acknowledge in ONE short sentence (warm, direct, no apology)
  2. Then deliver the required line naturally
  3. STOP
- If the lead said nothing unusual (just answered normally):
  1. Deliver the required line directly
  2. STOP
- Never add extra sentences after the required line
- Never skip the required line
- Never replace the required line with something else
- 2 sentences maximum total
`.trim();
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
  const scope = getScopeLabelForScriptKey(scriptKey);
  const isKaylaLead =
    normalizeScriptKey(ctx?.scriptKey) === "kayla_signup";

  if (isKaylaLead) {
    const kaylaScript = getScriptBlock(ctx);
    void kaylaScript;
    return `
You are ${aiName}, a virtual assistant calling on behalf of CoveCRM. You are warm, confident, and concise — like a sharp professional, not a salesperson.

YOUR ONLY JOB ON THIS CALL:
Have a short natural conversation about what they do, briefly explain what CoveCRM does for insurance agents, and if they seem interested, offer to text them a private discount code.

HARD TURN DISCIPLINE (NON-NEGOTIABLE):
- After every single thing you say, STOP and WAIT for them to respond.
- Never ask two questions in a row.
- Never explain more than one thing at a time.
- Keep every response to 1-2 sentences maximum.
- Do not fill silence. Do not keep talking.

TONE:
- Sound natural: warm, brief, confident.
- Use natural acknowledgments: "Got it", "Yeah absolutely", "Makes sense", "Sure" — woven in naturally, never forced.
- Mirror their energy. If they're brief, be brief. If they're chatty, match it.

WHAT YOU MAY DISCUSS:
- How CoveCRM helps insurance agents follow up faster with AI
- Lead management, folders, AI first call, AI dial sessions, AI SMS
- How it reduces manual work and missed leads
- Booking and pipeline organization

WHAT YOU MUST NEVER DO:
- Never give insurance quotes, rates, policy advice, or underwriting guidance
- Never guarantee results, bookings, or sales
- Never pressure or argue
- Never monologue or over-explain
- Do not proactively announce AI in the opener; if asked whether you are AI, automated, a bot, a robot, or virtual, answer honestly. Never mention scripts/prompts.

PRICING:
- If asked about price, say: "The signup page shows the current offer — I can text you a private discount code after the call if you want."

CLOSING:
- If they sound interested: "Want me to text you the private signup code?"
- If they say yes: confirm their number and say you will send it right after the call.

LEAD INFO:
- Name: ${ctx.clientFirstName || "there"}
- Notes: ${ctx.clientNotes || "(none)"}

MOST IMPORTANT:
Say one thing. Stop. Wait. Never keep talking after you ask something.
`.trim();
  }

  const base = `
You are ${aiName}, a virtual assistant making an outbound phone call on behalf of licensed agent ${agent}.
You are warm, calm, and naturally confident.

TONE & DELIVERY (READ THIS FIRST)
- Sound natural: use brief acknowledgments like "Sure", "Of course", "Absolutely", "Got it", "Yeah no worries" — naturally woven in, never forced.
- Mirror the lead’s energy. If they’re friendly, be friendly. If they’re brief, be brief. If they’re hesitant, slow down and stay warm.
- Never sound scripted. Deliver each line as if you’re speaking it for the first time.
- When the lead gives ANY response, acknowledge it genuinely before moving on. One natural word or phrase is enough.
- If a lead sounds confused: "No worries, let me explain quickly..." — then one clear sentence.
- If a lead sounds annoyed or rushed: "I totally get that — this’ll be really quick."
- If a lead is silent for more than a moment: "Hello — can you hear me okay?" — then wait again.
- Never fill silence with rambling. One acknowledgment, then the next step.
- Keep every turn to 1–2 sentences. Tighter is warmer.

HARD ENGLISH LOCK (NON-NEGOTIABLE)
- Speak ONLY English.

HARD NAME LOCK (NON-NEGOTIABLE)
- The ONLY name you may use for the lead is exactly: "${leadName}"
- If missing, use exactly: "there"
- NEVER invent or guess a name.

HARD SCOPE LOCK (NON-NEGOTIABLE)
- This call is ONLY about the lead’s ${scope} request that the lead submitted.
- Allowed topics ONLY: mortgage protection, final expense, cash value/IUL, veteran life programs.
- You MUST NEVER mention or discuss: resorts, hotels, vacations, timeshares, travel, energy plans, utilities, solar, Medicare, health insurance, ACA/Obamacare, auto insurance, home insurance, cable/internet, phone plans, warranties, debt relief, credit repair, alarms, security systems, banking, loans.

ABSOLUTE BEHAVIOR LOCK (NON-NEGOTIABLE)
- NEVER apologize.
- NEVER mention scripts, prompts, or system messages.
- NEVER introduce any other reason for calling.
- NEVER offer to give out the agent's phone number, email, or contact information. You are only scheduling a call — the agent will reach out to them directly.
- If you are about to say anything outside allowed scope, DO NOT SAY IT. Continue with the booking script.

BOOKING-ONLY (NON-NEGOTIABLE)
- You are NOT the licensed agent.
- Do NOT say you are an underwriter.
- Do NOT mention rates, carriers, approvals, eligibility, or ask health/age/DOB/SSN/banking questions.
- Do NOT ask or discuss ANY discovery or qualification topics, including but not limited to:
  age, date of birth, loan balance, mortgage amount, income, budget, coverage amount,
  policy type, health, medications, underwriting, rates, carriers, approvals, eligibility.
- Your ONLY goal is to follow the booking script and schedule the appointment.

MANDATORY REDIRECT RULE (NON-NEGOTIABLE)
- If the lead volunteers ANY of the above information, acknowledge briefly ("Got it", "Sure"),
  then IMMEDIATELY return to booking without asking follow-up questions.

TURN DISCIPLINE (NON-NEGOTIABLE)
- After you ask ANY question, STOP and WAIT.
- Do NOT fill silence with additional explanation.

CONTROL SCHEMA RULES (VERY IMPORTANT — KEEP SHORT)
- Emit control.kind="book_appointment" ONLY when the lead gives a clear time AND confirms it works.
  Include: startTimeUtc, durationMinutes, leadTimeZone, agentTimeZone, notes (optional).
- Emit control.kind="final_outcome" ONLY when it is clearly one of:
  booked / not_interested / do_not_call / disconnected.
  Include: outcome, summary (optional), notesAppend (optional).
- If not clearly booked or clearly final, emit NO control.

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
 * NOTE: We keep this function for backwards compatibility,
 * but we will NOT use it for normal script turns anymore.
 */
function buildStepperTurnInstructionNew(context: any, state: CallState): string {
  const stepLine = getCurrentStepperLine(state)?.line;
  const line = stepLine || getBookingFallbackLine(context);

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
 * ============================
 * ✅ Booking validation helpers
 * ============================
 * We do NOT change how the model decides times.
 * We only validate/safeguard what we send to CoveCRM.
 */
function isValidIanaTimeZone(tzRaw: any): boolean {
  const tz = String(tzRaw || "").trim();
  if (!tz) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * ✅ ONLY NEEDED UPDATE:
 * Prefer the lead time zone from CoveCRM context (ctx.raw.lead) when present.
 * This prevents the model from accidentally inventing/guessing a time zone.
 * (We do not change audio. Only booking payload safety.)
 */
function getLeadTimeZoneHintFromContext(ctx: AICallContext): string {
  try {
    const lead = ctx?.raw?.lead || {};
    const candidates = [
      lead?.timeZone,
      lead?.timezone,
      lead?.tz,
      lead?.leadTimeZone,
      lead?.lead_timezone,
    ].map((x: any) => String(x || "").trim());

    for (const c of candidates) {
      if (c && isValidIanaTimeZone(c)) return c;
    }
  } catch {}
  return "";
}

function normalizeTimeZones(
  leadTzRaw: any,
  agentTzRaw: any,
  ctx: AICallContext
): {
  leadTz: string;
  agentTz: string;
  leadTzWasFallback: boolean;
  agentTzWasFallback: boolean;
} {
  const ctxAgent = String(ctx?.agentTimeZone || "").trim();
  const leadCandidate = String(leadTzRaw || "").trim();
  const agentCandidate = String(agentTzRaw || "").trim();

  let leadTz = leadCandidate;
  let agentTz = agentCandidate;

  let leadTzWasFallback = false;
  let agentTzWasFallback = false;

  // Agent tz fallback chain
  if (!isValidIanaTimeZone(agentTz)) {
    if (isValidIanaTimeZone(ctxAgent)) {
      agentTz = ctxAgent;
      agentTzWasFallback = true;
    } else {
      agentTz = "America/Phoenix";
      agentTzWasFallback = true;
    }
  }

  // Lead tz fallback chain
  if (!isValidIanaTimeZone(leadTz)) {
    if (isValidIanaTimeZone(ctxAgent)) {
      leadTz = ctxAgent;
      leadTzWasFallback = true;
    } else {
      leadTz = "America/Phoenix";
      leadTzWasFallback = true;
    }
  }

  return { leadTz, agentTz, leadTzWasFallback, agentTzWasFallback };
}

function parseStartTimeUtcToDate(startTimeUtcRaw: any): Date | null {
  const raw = startTimeUtcRaw;

  // Epoch (seconds or ms)
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = raw;
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const s = String(raw || "").trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;

  return d;
}

function formatInTimeZone(d: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return fmt.format(d);
  } catch {
    return "(format_failed)";
  }
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
                console.log("[AI-VOICE] Kicking worker:", workerUrl.toString());
                const workerResp = await fetch(workerUrl.toString(), {
                  method: "POST",
                  headers: {
                    "x-cron-key": AI_DIALER_CRON_KEY,
                  },
                });
                console.log("[AI-VOICE] Worker kick response:", workerResp.status);
              } catch (err: any) {
                console.error(
                  "[AI-VOICE] Error kicking AI worker from /start-session:",
                  err?.message || err
                );
              }
            } else {
              console.warn("[AI-VOICE] AI_DIALER_CRON_KEY not set — worker not kicked");
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

      if (req.method === "POST" && url.pathname === "/trigger-call") {
        // Validate API secret
        const authHeader = req.headers["x-api-secret"] || req.headers["authorization"] || "";
        const token = Array.isArray(authHeader) ? authHeader[0] : String(authHeader);
        const bare = token.replace(/^Bearer\s+/i, "");
        if (!COVECRM_API_SECRET || bare !== COVECRM_API_SECRET) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
          return;
        }

        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", async () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const { userEmail, leadId, leadPhone, scriptKey, fromNumber } = payload;

            if (!userEmail || !leadPhone) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "userEmail and leadPhone are required" }));
              return;
            }

            if (!fromNumber) {
              console.warn("[AI-VOICE] Cannot place call — user-owned number required");
              res.statusCode = 503;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "Cannot place call — user-owned number required" }));
              return;
            }

            const triggerUrl = new URL("/api/ai-calls/trigger-call", COVECRM_BASE_URL);
            const triggerRes = await fetch(triggerUrl.toString(), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-secret": COVECRM_API_SECRET,
              },
              body: JSON.stringify({
                userEmail,
                leadId: leadId || "",
                leadPhone,
                scriptKey: scriptKey || "",
                fromNumber,
              }),
            });

            const triggerData: any = await triggerRes.json().catch(() => ({}));

            if (!triggerRes.ok) {
              console.error("[AI-VOICE] /trigger-call CoveCRM error:", triggerData);
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: triggerData?.error || "CoveCRM call trigger failed" }));
              return;
            }

            console.log("[AI-VOICE] /trigger-call initiated:", {
              callSid: triggerData?.callSid,
              to: triggerData?.to || leadPhone,
              userEmail,
              leadId,
            });

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, callSid: triggerData?.callSid }));
          } catch (err: any) {
            console.error("[AI-VOICE] /trigger-call error:", err?.message || err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: err?.message || "Internal error" }));
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

    // script adherence defaults
    scriptSteps: [],
    scriptStepIndex: 0,
    lastUserTranscript: "",
    lastPromptSentAtMs: 0,
    lastPromptLine: "",
    repromptCountForCurrentStep: 0,
    lowSignalCommitCount: 0,
    debugLoggedResponseCreateGreeting: false,
    debugLoggedResponseCreateUserTurn: false,

    // ✅ turn-taking fixes
    responseInFlight: false,
    bargeInDetected: false,
    bargeInAudioMsBuffered: 0,
    bargeInFrames: [],
    lastCancelAtMs: 0,
    lastResponseCreateAtMs: 0,
    lastSilenceSentAtMs: 0,
    inputCommitInFlight: false,
    lastInputCommitAtMs: 0,
    pendingLiveTransferAvailabilityAttempts: 0,
    resolvedObjectionKinds: [],
    routeSequenceId: 0,
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
      st.phase = "ended";
      stopOutboundPacer(ws, st, "twilio ws close");

      // ✅ best-effort billing on close (Twilio may not always deliver a clean `stop`)
      billAiDialerUsageForCall(st).catch((err: any) => {
        console.error(
          "[AI-VOICE] Error billing AI Dialer usage (ws close):",
          err?.message || err
        );
      });

      if (!st.finalOutcomeSent && st.context) {
        const answeredBy = String(st.context.answeredBy || "").toLowerCase();
        const outcome = isVoicemailAnsweredBy(answeredBy) ? "no_answer" : "unknown";
        handleFinalOutcomeIntent(st, {
          kind: "final_outcome",
          outcome,
          summary: "Call ended via WebSocket close.",
          notesAppend: `answeredBy: ${answeredBy || "unknown"}. Lead left in original folder per policy.`,
        }).catch(() => {});
        st.finalOutcomeSent = true;
      }
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

async function assertRealtimeModelAccessible() {
  // IMPORTANT: do NOT use /v1/models here.
  // Some keys (including certain admin/service keys) can be blocked from listing models (403),
  // even though they CAN use the model. Instead, we do a real canary: create a realtime session.
  const key = OPENAI_API_KEY;
  const model = OPENAI_REALTIME_MODEL;

  if (!key) {
    console.error("[AI-VOICE] ⚠️ Realtime session canary skipped: OPENAI_API_KEY is missing.");
    return;
  }
  if (!model) {
    console.error("[AI-VOICE] ⚠️ Realtime session canary skipped: OPENAI_REALTIME_MODEL is missing.");
    return;
  }

  const url = "https://api.openai.com/v1/realtime/sessions";
  let bodyText = "";
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        modalities: ["audio", "text"],
        input_audio_format: OPENAI_REALTIME_AUDIO_FORMAT,
        output_audio_format: OPENAI_REALTIME_AUDIO_FORMAT,
        // Keep this minimal — we only want to validate access + model name.
      }),
    });

    bodyText = await resp.text().catch(() => "");

    if (!resp.ok) {
      // Surface the body because OpenAI typically explains model/permission issues there.
      console.error(
        `[AI-VOICE] ⚠️ Realtime session canary failed for model='${model}' status=${resp.status} body=${bodyText.slice(0, 400)}`
      );
      return;
    }

    // Success: nothing else to do.
    try {
      console.log("[AI-VOICE] Startup guard OK: realtime session canary succeeded for model:", model);
    } catch {}
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(
      `[AI-VOICE] ⚠️ Realtime session canary errored for model='${model}': ${msg}` +
        (bodyText ? ` body=${bodyText.slice(0, 400)}` : "")
    );
  }
}


async function startServer() {
  await assertRealtimeModelAccessible();
  server.listen(PORT, () => {
    console.log(`[AI-VOICE] HTTP + WebSocket server listening on port ${PORT}`);
  });
}

startServer().catch((err: any) => {
  console.error("[AI-VOICE] FATAL startup guard failed:", err?.message || err);
  process.exit(1);
});

/**
 * START
 */
/**
 * ✅ LIVE TRANSFER — redirect call to agent phone via Twilio REST API.
 * Called after lead confirms interest (script step 1 → 2 advance).
 * If agent doesn't answer, Twilio calls transfer-fallback.ts which plays a graceful message.
 */
async function performLiveTransfer(ws: WebSocket, state: CallState): Promise<void> {
  const ctx = state.context;
  if (!ctx) return;
  if (!ctx.liveTransferEnabled || !ctx.liveTransferPhone) return;
  if (state.phase === "ended") return;
  if (state.waitingForResponse || state.responseInFlight || state.aiSpeaking) {
    console.log("[AI-VOICE][LIVE-TRANSFER] Skipping transfer while response is active", {
      callSid: state.callSid,
      waitingForResponse: !!state.waitingForResponse,
      responseInFlight: !!state.responseInFlight,
      aiSpeaking: !!state.aiSpeaking,
    });
    return;
  }
  state.transferStarting = true;
  state.pendingCommittedTurn = null;

  const agentFirst = (ctx.agentName || "my agent").split(" ")[0] || "my agent";
  const leadName = ctx.clientFirstName || "them";
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);

  const recoverFromTransferFailure = (reason: string) => {
    try {
      state.transferStarting = false;
      state.transferInProgress = false;
      state.pendingLiveTransferAfterLine = false;
      state.pendingCommittedTurn = null;
      if (state.phase === "ended") return;
      if (!state.openAiWs || state.openAiWs.readyState !== WebSocket.OPEN || !state.openAiReady) return;
      if (state.waitingForResponse || state.responseInFlight || state.aiSpeaking) return;

      const lineToSay = `Okay, looks like ${agentFirst} isn’t available right this second. What time works later today or tomorrow?`;
      const instr = buildExactScriptLineInstruction(lineToSay, {
        recentExchanges: state.recentExchanges,
        scope: state.context ? getScopeLabelForScriptKey(state.context.scriptKey) : "life insurance",
        agent: state.context ? (state.context.agentName || "the agent").split(" ")[0] : "the agent",
        leadName: state.context ? (state.context.clientFirstName || "there") : "there",
      });

      const steps = state.scriptSteps || [];
      const currentIdx = typeof state.scriptStepIndex === "number" ? state.scriptStepIndex : 1;
      if (steps.length > 0) {
        state.scriptStepIndex = Math.min(currentIdx + 1, Math.max(0, steps.length - 1));
        state.awaitingAnswerForStepIndex = Math.max(0, state.scriptStepIndex - 1);
      } else {
        state.awaitingAnswerForStepIndex = undefined;
      }

      state.awaitingUserAnswer = false;
      state.userAudioMsBuffered = 0;
      state.lastUserTranscript = "";
      state.lowSignalCommitCount = 0;
      state.repromptCountForCurrentStep = 0;

      setWaitingForResponse(state, true, "response.create (live-transfer failure fallback)");
      setAiSpeaking(state, true, "response.create (live-transfer failure fallback)");
      setResponseInFlight(state, true, "response.create (live-transfer failure fallback)");
      state.outboundOpenAiDone = false;
      state.lastPromptSentAtMs = Date.now();
      state.lastPromptLine = lineToSay;
      state.lastResponseCreateAtMs = Date.now();
      state.phase = "in_call";
      state.openAiWs.send(JSON.stringify(buildRealtimeResponseCreate(instr)));
      state.awaitingUserAnswer = true;

      console.log("[AI-VOICE][LIVE-TRANSFER] recovered to booking flow after redirect failure", {
        callSid: state.callSid,
        reason,
      });
    } catch (err: any) {
      console.warn("[AI-VOICE][LIVE-TRANSFER] failure recovery could not speak fallback:", err?.message || err);
    }
  };

  console.log("[AI-VOICE][LIVE-TRANSFER] Initiating transfer", {
    callSid: state.callSid,
    agentPhone: ctx.liveTransferPhone,
    leadName,
  });

  // 1. Say transfer line unless the availability interstitial already spoke it.
  const transferLine = getLiveTransferTryingLine(ctx);

  try {
    if (!state.liveTransferIntroSpoken && state.openAiWs && state.openAiWs.readyState === WebSocket.OPEN) {
      setWaitingForResponse(state, true, "live-transfer speak");
      setAiSpeaking(state, true, "live-transfer speak");
      setResponseInFlight(state, true, "live-transfer speak");
      state.outboundOpenAiDone = false;
      state.openAiWs.send(JSON.stringify(buildRealtimeResponseCreate(
        `Say EXACTLY this sentence and nothing else: "${transferLine}" Then stop completely.`
      )));
    }
  } catch (err: any) {
    console.warn("[AI-VOICE][LIVE-TRANSFER] Failed to send transfer line:", err?.message);
  }

  // 2. Wait for AI to finish speaking (~4 seconds for one sentence)
  if (!state.liveTransferIntroSpoken) {
    await new Promise((r) => setTimeout(r, 4500));
  }

  const phaseAfterSpeak = (state as { phase?: CallPhase }).phase;
  if (phaseAfterSpeak === "ended") {
    state.transferStarting = false;
    state.transferInProgress = false;
    return;
  }

  // 3. Redirect the call via Twilio REST API
  // Capture booking context for the fallback in case agent doesn't answer
  const exactTimeText = String((state as any).lastExactTimeText || "").trim();
  const leadTimeZone = String(getLeadTimeZoneHintFromContext(ctx) || ctx.agentTimeZone || "America/Phoenix").trim();
  const agentTimeZone = String(ctx.agentTimeZone || "America/Phoenix").trim();

  let startTimeUtcForFallback = "";
  try {
    const agentTz = agentTimeZone;
    const nowInAgentTz = new Date().toLocaleString("en-US", { timeZone: agentTz });
    const todayStr = new Date(nowInAgentTz).toLocaleDateString("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    const parseSpokenTime = (raw: string, dateStr: string, tz: string): Date | null => {
      try {
        const t = raw.trim().toLowerCase();
        const match = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
        if (!match) return null;
        let hh = Number(match[1]);
        const mm = Number(match[2] || "0");
        const meridiem = (match[3] || "").toLowerCase();
        if (meridiem === "pm" && hh !== 12) hh += 12;
        if (meridiem === "am" && hh === 12) hh = 0;
        if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
        const [mo, da, yr] = dateStr.split("/").map(Number);
        if (!mo || !da || !yr) return null;
        const localIso = `${yr}-${String(mo).padStart(2,"0")}-${String(da).padStart(2,"0")}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00`;
        const approxUtc = new Date(localIso + "Z");
        const tzParts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz, hour12: false,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }).formatToParts(approxUtc);
        const tzH = Number(tzParts.find(p => p.type === "hour")?.value || 0);
        const tzM = Number(tzParts.find(p => p.type === "minute")?.value || 0);
        const diffMinutes = (hh * 60 + mm) - (tzH * 60 + tzM);
        const result = new Date(approxUtc.getTime() + diffMinutes * 60 * 1000);
        if (isNaN(result.getTime())) return null;
        return result;
      } catch { return null; }
    };
    const startDate = parseSpokenTime(exactTimeText, todayStr, agentTz);
    if (startDate && !isNaN(startDate.getTime())) {
      startTimeUtcForFallback = startDate.toISOString();
    }
  } catch {
    // leave startTimeUtcForFallback as ""
  }

  try {
    const transferUrl = new URL(TRANSFER_TWIML_URL);
    transferUrl.searchParams.set("agentPhone", ctx.liveTransferPhone);
    transferUrl.searchParams.set("leadName", leadName);
    transferUrl.searchParams.set("agentName", agentFirst);
    transferUrl.searchParams.set("scope", scope);
    transferUrl.searchParams.set("key", AI_DIALER_CRON_KEY);
    transferUrl.searchParams.set("sessionId", ctx.sessionId || "");
    transferUrl.searchParams.set("leadId", ctx.leadId || "");
    transferUrl.searchParams.set("callSid", state.callSid || "");
    transferUrl.searchParams.set("exactTimeText", exactTimeText);
    transferUrl.searchParams.set("startTimeUtc", startTimeUtcForFallback);
    transferUrl.searchParams.set("leadTimeZone", leadTimeZone);
    transferUrl.searchParams.set("agentTimeZone", agentTimeZone);
    transferUrl.searchParams.set("userEmail", ctx.userEmail || "");
    transferUrl.searchParams.set("leadPhone", ctx.clientPhone || "");

    const twilioCallUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${state.callSid}.json`;
    const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

    state.transferInProgress = true;
    const redirectRes = await fetch(twilioCallUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Url: transferUrl.toString() }).toString(),
    });

    if (redirectRes.ok) {
      console.log("[AI-VOICE][LIVE-TRANSFER] Call redirected to agent", {
        callSid: state.callSid,
        agentPhone: ctx.liveTransferPhone,
      });
      state.transferStarting = false;
      state.phase = "ended";
      safelyCloseOpenAi(state, "live transfer redirect");
      return;
    } else {
      const errBody = await redirectRes.text().catch(() => "");
      console.error("[AI-VOICE][LIVE-TRANSFER] Twilio redirect failed", {
        status: redirectRes.status,
        body: errBody.slice(0, 200),
      });
      recoverFromTransferFailure(`redirect_failed_${redirectRes.status}`);
      return;
    }
  } catch (err: any) {
    console.error("[AI-VOICE][LIVE-TRANSFER] Error redirecting call:", err?.message);
    recoverFromTransferFailure("redirect_exception");
    return;
  }
}

async function handleStart(ws: WebSocket, msg: TwilioStartEvent) {
  const state = calls.get(ws);
  if (!state) return;

  state.streamSid = msg.streamSid;
  state.callSid = msg.start.callSid;
  state.callStartedAtMs = Date.now();
  state.billedUsageSent = false;

  // Safety: auto-close call after 20 minutes to prevent runaway costs
  setTimeout(() => {
    try {
      const live = calls.get(ws);
      if (!live || live.phase === "ended") return;
      console.log("[AI-VOICE][TIMEOUT] 20-minute call timeout — closing", {
        callSid: live.callSid,
      });
      live.phase = "ended";
      clearSilenceWatchdog(live, "20min timeout");
      stopOutboundPacer(ws, live, "20min timeout");
      safelyCloseOpenAi(live, "20min timeout");
    } catch {}
  }, 20 * 60 * 1000);

  setWaitingForResponse(state, false, "start/reset");
  setAiSpeaking(state, false, "start/reset");
  setResponseInFlight(state, false, "start/reset");

  clearSilenceWatchdog(state, "start/reset");
  state.userAudioMsBuffered = 0;
  state.initialGreetingQueued = false;
  state.phase = "init";
  state.silenceWatchdog = null;

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
  (state as any).greetingAudioStarted = false;
  (state as any).greetingAudioDone = false;
  (state as any).voicemailMidCallCheckDone = false;

  // script adherence reset
  state.scriptSteps = [];
  state.scriptStepIndex = 0;
  state.lastUserTranscript = "";
  state.lastPromptSentAtMs = Date.now();
  state.lastPromptLine = "";
  state.repromptCountForCurrentStep = 0;
  state.lowSignalCommitCount = 0;
  state.debugLoggedResponseCreateGreeting = false;
  state.debugLoggedResponseCreateUserTurn = false;

  // prompt instrumentation reset
  state.systemPromptLen = undefined;
  state.systemPromptHead300 = undefined;
  state.systemPromptTail700 = undefined;
  state.systemPromptMarkers = undefined;
  state.systemPromptUniqueLine = undefined;

  // ✅ turn-taking reset
  // ✅ turn-taking answer gating reset
  state.lastUserSpeechStartedAtMs = undefined;
  state.lastUserSpeechStoppedAtMs = undefined;
  state.lastAiDoneAtMs = undefined;
  state.awaitingUserAnswer = false;
  state.awaitingAnswerForStepIndex = undefined;

  // ── conversation memory reset ──
  state.recentExchanges = [];
  state.lastObjectionKind = undefined;
  state.objectionRepeatCount = 0;

  // ✅ reset one-time TURN-GATE logs for this call
  (state as any).__turnGateLogAwaitingFalse = false;
  (state as any).__turnGateLogNoStopped = false;
  (state as any).__turnGateLogSettle = false;
  (state as any).__turnGateLogAiOverlap = false;

  state.bargeInDetected = false;
  state.bargeInAudioMsBuffered = 0;
  state.bargeInFrames = [];
  state.lastCancelAtMs = 0;
  state.lastResponseCreateAtMs = Date.now();
  state.lastSilenceSentAtMs = 0;

  const custom = msg.start.customParameters || {};
  const sessionId = custom.sessionId;
  const leadId = custom.leadId;
  const callDirection = String(custom.callDirection || "").trim().toLowerCase();
  const rebookingMode = String(custom.rebookingMode || "").trim() === "true";
  const rebookingLeadName = String(custom.leadName || "").trim();
  const rebookingAgentRaw = String(custom.agentName || "").trim();
  const rebookingAgentFirst = (rebookingAgentRaw.split(" ")[0] || "our agent").trim();

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
    if (callDirection && !(context as any).callDirection) {
      (context as any).callDirection = callDirection;
    }
    state.context = context;
    (state as any).rebookingMode = rebookingMode;
    (state as any).rebookingLeadName = rebookingLeadName;
    (state as any).rebookingAgentFirst = rebookingAgentFirst;

    console.log(
      `[AI-VOICE] Loaded context for ${context.clientFirstName} (agent: ${context.agentName}, voice: ${context.voiceProfile.aiName}, openAiVoiceId: ${context.voiceProfile.openAiVoiceId}, scriptKey: ${context.scriptKey}, answeredBy: ${
        context.answeredBy || "(none)"
      }, callDirection: ${context.callDirection || "outbound"})`
    );

    await initOpenAiRealtime(ws, state);
  } catch (err: any) {
    console.error("[AI-VOICE] Error fetching AI context:", err?.message || err);
  }
}

let _mulawToPcm16Lut: Int16Array | null = null;

function isLikelySilenceMulawBase64(payloadB64: string): boolean {
  try {
    if (!payloadB64) return true;
    const buf = Buffer.from(payloadB64, "base64");
    if (buf.length === 0) return true;

    // Fast path: true digital silence frames are often all/mostly 0xFF (sometimes 0x7F).
    let silenceBytes = 0;
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b === 0xff || b === 0x7f) silenceBytes++;
    }
    if (silenceBytes / buf.length >= 0.95) return true;

    // Build μ-law decode LUT once (cheap + avoids per-sample math each frame)
    if (!_mulawToPcm16Lut) {
      const lut = new Int16Array(256);
      for (let i = 0; i < 256; i++) {
        // Standard G.711 μ-law to 16-bit PCM decode
        let mu = (~i) & 0xff;
        const sign = (mu & 0x80) ? -1 : 1;
        const exponent = (mu >> 4) & 0x07;
        const mantissa = mu & 0x0f;
        let sample = ((mantissa << 4) + 0x08) << (exponent + 3);
        sample = sample - 0x84;
        lut[i] = (sign * sample) as any;
      }
      _mulawToPcm16Lut = lut;
    }

    const lut = _mulawToPcm16Lut!;
    let sumAbs = 0;
    let quiet = 0;

    for (let i = 0; i < buf.length; i++) {
      const v = lut[buf[i]];
      const a = v < 0 ? -v : v;
      sumAbs += a;
      if (a < 600) quiet++;
    }

    const avgAbs = sumAbs / buf.length;
    const quietRatio = quiet / buf.length;

    // Basic silence only. Avoid aggressive comfort-noise heuristics that starve soft speech.
    return avgAbs < 900 && quietRatio >= 0.85;
  } catch {
    // COST SAFETY: if silence detection fails on a frame, treat it as silence.
    // Otherwise we can end up streaming continuous "non-silence" to OpenAI and costs explode.
    return true;
  }
}

function recordInboundForwardMeter(
  state: CallState,
  kind: "appended" | "droppedIdleSilence",
  isSpeechLike: boolean,
  activeSpeechWindow = false,
  trailingSpeechWindow = false
) {
  try {
    if (kind === "appended") {
      (state as any)._dbgFwdAppendedFrames = Number((state as any)._dbgFwdAppendedFrames || 0) + 1;
    } else {
      (state as any)._dbgFwdDroppedIdleSilence = Number((state as any)._dbgFwdDroppedIdleSilence || 0) + 1;
    }
    if (isSpeechLike) {
      (state as any)._dbgFwdSpeechLike = Number((state as any)._dbgFwdSpeechLike || 0) + 1;
    } else {
      (state as any)._dbgFwdSilenceLike = Number((state as any)._dbgFwdSilenceLike || 0) + 1;
    }
    if (activeSpeechWindow) {
      (state as any)._dbgFwdActiveSpeechWindow = Number((state as any)._dbgFwdActiveSpeechWindow || 0) + 1;
    }
    if (trailingSpeechWindow) {
      (state as any)._dbgFwdTrailingSpeechWindow = Number((state as any)._dbgFwdTrailingSpeechWindow || 0) + 1;
    }

    const now = Date.now();
    const last = Number((state as any)._dbgFwdLogAtMs || 0);
    if (last <= 0) (state as any)._dbgFwdLogAtMs = now;
    if (now - Number((state as any)._dbgFwdLogAtMs || 0) >= 2000) {
      const appended = Number((state as any)._dbgFwdAppendedFrames || 0);
      const dropped = Number((state as any)._dbgFwdDroppedIdleSilence || 0);
      const speechLike = Number((state as any)._dbgFwdSpeechLike || 0);
      const silenceLike = Number((state as any)._dbgFwdSilenceLike || 0);
      const activeWindow = Number((state as any)._dbgFwdActiveSpeechWindow || 0) > 0;
      const trailingWindow = Number((state as any)._dbgFwdTrailingSpeechWindow || 0) > 0;
      console.log("[AI-VOICE][FWD-METER]", {
        callSid: state.callSid,
        phase: state.phase,
        awaitingUserAnswer: !!state.awaitingUserAnswer,
        inFlight: !!(state as any).responseInFlight,
        waiting: !!state.waitingForResponse,
        aiSpeaking: !!state.aiSpeaking,
        appendedFrames2s: appended,
        droppedIdleSilence2s: dropped,
        speechLike2s: speechLike,
        silenceLike2s: silenceLike,
        activeSpeechWindow: activeWindow,
        trailingSpeechWindow: trailingWindow,
      });
      (state as any)._dbgFwdAppendedFrames = 0;
      (state as any)._dbgFwdDroppedIdleSilence = 0;
      (state as any)._dbgFwdSpeechLike = 0;
      (state as any)._dbgFwdSilenceLike = 0;
      (state as any)._dbgFwdActiveSpeechWindow = 0;
      (state as any)._dbgFwdTrailingSpeechWindow = 0;
      (state as any)._dbgFwdLogAtMs = now;
    }
  } catch {}
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

  const recentlyCancelled = (Date.now() - Number(state.lastCancelAtMs || 0)) < 1500;

  /**
   * ✅ CRITICAL FIX:
   * DO NOT DROP inbound frames during AI speech/wait/outbound drain.
   * Instead:
   * - if user speaks during AI speech OR while outbound is draining -> barge-in cancel
   * - keep a tiny frame buffer so we don't lose the start of their reply
   * - after cancel, forward audio normally
   */
    const blockedByAiTurn =
    ((state.aiSpeaking === true) && !recentlyCancelled) ||
    state.waitingForResponse === true ||
    outboundInProgress;

  if (blockedByAiTurn) {
    const isSilence = isLikelySilenceMulawBase64(payload);

    // Only consider barge-in if the AI is actively speaking AND an OpenAI response is still active.
    // (waitingForResponse / outbound draining / already-done is NOT a reason to cancel)
    if (
      state.aiSpeaking === true &&
      state.responseInFlight === true &&
      state.outboundOpenAiDone !== true &&
      !isSilence
    ) {
      // Track sustained caller speech while AI is speaking.
      state.bargeInDetected = true;
      state.bargeInAudioMsBuffered = Math.min(
        800,
        (state.bargeInAudioMsBuffered || 0) + 20
      );

      // Keep a tiny ring buffer (~200ms) so we don't lose their first words
      const ring = state.bargeInFrames || [];
      ring.push(payload);
      while (ring.length > 10) ring.shift(); // 10 * 20ms = 200ms
      state.bargeInFrames = ring;

      const now = Date.now();
      const aiAudioStartedAt = Number(state.aiAudioStartedAtMs || 0);

      // Barge-in cooldown: ignore the first ~650ms after AI audio actually starts
      const cooldownOk = aiAudioStartedAt > 0 && (now - aiAudioStartedAt) >= 650;

      // Require sustained speech: at least 200ms of non-silence while AI is speaking
      const sustainedOk = Number(state.bargeInAudioMsBuffered || 0) >= 700;

      if (cooldownOk && sustainedOk) {
        // ✅ Patch 5: ignore micro-interjections ("um", quick noises). Require truly sustained speech.
        const ms = Number(state.bargeInAudioMsBuffered || 0);
        if (ms >= 700) {
          // Cancel only for validated barge-in while AI is speaking
          tryCancelOpenAiResponse(state, "ai-speaking");
        }
      }
    }

    // ✅ COST CUT (SAFE): do NOT stream continuous idle silence to OpenAI.
    // IMPORTANT: we MUST allow trailing silence after *any* user speech so server_vad can detect end-of-speech && commit.
    // Using userAudioMsBuffered alone can fail for very short replies (1 frame). Use VAD timestamps as the primary signal.
    const nowMs_gate = Date.now();
    const startedAt_gate = Number((state as any).lastUserSpeechStartedAtMs || 0);
    const stopAt_gate = Number((state as any).lastUserSpeechStoppedAtMs || 0);
    const userSpokeRecently_gate = (
      (startedAt_gate > 0 && (nowMs_gate - startedAt_gate) <= 1200) ||
      (stopAt_gate > 0 && (nowMs_gate - stopAt_gate) <= 1200) ||
      Number(state.userAudioMsBuffered || 0) >= 20  // 1 frame minimum
    );
    if (isSilence && !userSpokeRecently_gate) return;

        // While AI is actively speaking, never forward live user audio to OpenAI (we buffer for barge-in instead).
    // EXCEPT: right after a barge-in cancel, we must allow inbound audio through immediately so VAD/transcription can lock.
    if (state.aiSpeaking === true && (state as any).responseInFlight === true && !recentlyCancelled) return;
  }


  // accumulate inbound audio while user is talking (only meaningful for gating once we're forwarding)
  // Count ONLY non-silence frames; silence can inflate audioMs gates and cause premature turn-taking.
  try {
    const isSilenceForGate = isLikelySilenceMulawBase64(payload);
    if (!isSilenceForGate) {
      state.userAudioMsBuffered = Math.min(
        3000,
        (state.userAudioMsBuffered || 0) + 20
      );
    }
  } catch {
    // Fallback: if silence detector fails, keep prior behavior (should be rare)
    state.userAudioMsBuffered = Math.min(
      3000,
      (state.userAudioMsBuffered || 0) + 20
    );
  }

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
    // If OpenAI not ready yet, buffer as before (unchanged)
    state.pendingAudioFrames.push(payload);
    return;
  }

  /**
   * If we just barged-in and cancelled, flush the tiny buffered frames first,
   * then continue with normal appends. This prevents losing the first words.
   */
  try {
    if (state.bargeInDetected && (state.bargeInFrames?.length || 0) > 0) {
      const frames = state.bargeInFrames || [];
      state.bargeInFrames = [];
      state.bargeInDetected = false;
      state.bargeInAudioMsBuffered = 0;

      for (const f of frames) {
        state.openAiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: f,
          })
        );
      }
      return; // we already appended the ring buffer including this frame
    }

    // Normal path: forward only during a simple speech window.
    // Outside that window, drop idle inbound audio completely.
    const isListening =
      !state.waitingForResponse &&
      !(state as any).responseInFlight &&
      !state.aiSpeaking;
    if (!isListening) {
      return;
    }

    // HARD COST GATE: never stream audio to OpenAI unless we are actively in a call
    // with a live context AND the call is in a phase where user speech is expected.
    // This is the primary defense against dead-air cost spikes.
    const isActiveCall = !!state.context && !!state.openAiWs && !!state.openAiReady;
    const isInSpeakingPhase =
      state.phase === "awaiting_greeting_reply" ||
      state.phase === "in_call";

    if (!isActiveCall || !isInSpeakingPhase) {
      return;
    }

    const nowMs = Date.now();
    const startedAt = Number((state as any).lastUserSpeechStartedAtMs || 0);
    const stopAt = Number((state as any).lastUserSpeechStoppedAtMs || 0);
    const isInboundSilence = isLikelySilenceMulawBase64(payload);
    const isInboundSpeechLike = !isInboundSilence;

    if (isInboundSpeechLike) {
      (state as any).lastLocalSpeechActivityAtMs = nowMs;
    }
    const lastLocalSpeechAt = Number((state as any).lastLocalSpeechActivityAtMs || 0);

    const openAiSpeechWindow =
      startedAt > 0 &&
      (nowMs - startedAt) <= 3500 &&
      (stopAt <= 0 || stopAt < startedAt);
    const localSpeechWindow =
      lastLocalSpeechAt > 0 &&
      (nowMs - lastLocalSpeechAt) <= 900;
    const trailingSpeechWindow =
      stopAt > 0 &&
      stopAt >= startedAt &&
      (nowMs - stopAt) <= 1200;
    const activeSpeechWindow = openAiSpeechWindow || localSpeechWindow;

    // Safety reset: if OpenAI never sends speech_stopped, do NOT let userSpeechInProgress stay true forever.
    try {
      if (state.userSpeechInProgress && !openAiSpeechWindow && startedAt > 0 && (nowMs - startedAt) > 3500) {
        state.userSpeechInProgress = false;
      }
    } catch {}

    if (!activeSpeechWindow && !trailingSpeechWindow) {
      recordInboundForwardMeter(state, "droppedIdleSilence", isInboundSpeechLike, activeSpeechWindow, trailingSpeechWindow);
      return;
    }

    recordInboundForwardMeter(state, "appended", isInboundSpeechLike, activeSpeechWindow, trailingSpeechWindow);

    state.openAiWs.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: payload,
      })
    );

    try {
      (state as any)._totalAudioMsSentToOpenAi =
        ((state as any)._totalAudioMsSentToOpenAi || 0) + 20;
      const total = Number((state as any)._totalAudioMsSentToOpenAi || 0);
      const lastLogAt = Number((state as any)._audioMeterLogAt || 0);
      if (total - lastLogAt >= 30000) {
        (state as any)._audioMeterLogAt = total;
        const inputMinutes = total / 60000;
        const estimatedInputCost = inputMinutes * 0.10;
        console.log("[AI-VOICE][COST-METER] Audio streamed to OpenAI:", {
          callSid: state.callSid,
          inputMinutes: inputMinutes.toFixed(2),
          estimatedInputCostUsd: estimatedInputCost.toFixed(4),
          phase: state.phase,
          awaitingUserAnswer: !!state.awaitingUserAnswer,
        });
      }
    } catch {}
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

  if (!state.finalOutcomeSent && state.context) {
    const answeredBy = String(state.context.answeredBy || "").toLowerCase();
    const outcome = isVoicemailAnsweredBy(answeredBy) ? "no_answer" : "unknown";
    console.log("[AI-VOICE][OUTCOME][FALLBACK]", {
      callSid: state.callSid,
      outcome,
      reason: "call ended without explicit outcome signal",
    });
    void handleFinalOutcomeIntent(state, {
      kind: "final_outcome",
      outcome,
      summary: "Call ended — outcome not explicitly confirmed during call.",
      notesAppend: `answeredBy: ${answeredBy || "unknown"}. Lead left in original folder per policy.`,
    }).catch(() => {});
    state.finalOutcomeSent = true;
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
    },
  });

  state.openAiWs = openAiWs;

  openAiWs.on("open", () => {
    console.log("[AI-VOICE] OpenAI Realtime connected");

    state.openAiReady = false;
    state.openAiConfigured = false;

    const systemPrompt = buildSystemPrompt(state.context!);

    try {
      const selectedScript = getSelectedScriptText(state.context!);
      const steps = extractScriptStepsFromSelectedScript(selectedScript);
      const uniqueLine = steps?.[0] || "";

      const redacted = redactPromptForLogs(systemPrompt);

      state.systemPromptLen = systemPrompt.length;
      state.systemPromptHead300 = safeSliceHead(redacted, 300);
      state.systemPromptTail700 = safeSliceTail(redacted, 700);
      state.systemPromptUniqueLine = uniqueLine;
      state.systemPromptMarkers = computePromptMarkers(systemPrompt, uniqueLine);

      console.log("[AI-VOICE][PROMPT-BUILD]", {
        callSid: state.callSid,
        streamSid: state.streamSid,
        scriptKey: normalizeScriptKey(state.context?.scriptKey),
        openAiVoiceId: state.context?.voiceProfile?.openAiVoiceId,
        systemPromptLen: state.systemPromptLen,
        markers: state.systemPromptMarkers,
        uniqueLineIncluded: state.systemPromptMarkers?.has_unique_line,
        head300: state.systemPromptHead300,
        tail700: state.systemPromptTail700,
      });
    } catch (err: any) {
      console.warn("[AI-VOICE][PROMPT-BUILD] logging failed (non-blocking):", {
        callSid: state.callSid,
        error: err?.message || err,
      });
    }

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

    try {
      const selectedScript = getSelectedScriptText(state.context!);
      state.scriptSteps = extractScriptStepsFromSelectedScript(selectedScript);
      state.scriptStepIndex = 0;

      console.log("[AI-VOICE][STEPPER-INIT]", {
        callSid: state.callSid,
        streamSid: state.streamSid,
        scriptKey: normalizeScriptKey(state.context?.scriptKey),
        stepsCount: state.scriptSteps.length,
        firstStepPreview: (state.scriptSteps[0] || "").slice(0, 120),
      });
    } catch (err: any) {
      console.warn("[AI-VOICE][STEPPER-INIT] failed (non-blocking):", {
        callSid: state.callSid,
        error: err?.message || err,
      });
      state.scriptSteps = [];
      state.scriptStepIndex = 0;
    }

    const sessionUpdate = {
      type: "session.update",
      session: {
        type: "realtime",
        model: OPENAI_REALTIME_MODEL,
        instructions: systemPrompt,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            transcription: {
              model: "gpt-4o-mini-transcribe",
              language: "en",
            },
            turn_detection: {
              type: "server_vad",
              create_response: false,

              // Short enough to not hang on pauses, long enough to not cut off natural speech
              silence_duration_ms: 400,

              // Balanced threshold — rejects comfort noise but catches real speech
              threshold: 0.85,

              // Capture speech from the very start of each user turn
              prefix_padding_ms: 300,
            },
          },
          output: {
            voice: state.context!.voiceProfile.openAiVoiceId || "alloy",
            format: { type: "audio/pcmu" },
          },
        },
      },
    };

    try {
      console.log("[AI-VOICE] Sending session.update with voice:", {
        openAiVoiceId: state.context!.voiceProfile.openAiVoiceId,
        model: OPENAI_REALTIME_MODEL,
        apiShape: "ga",
        inputAudioFormat: "audio/pcmu",
        outputAudioFormat: "audio/pcmu",
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
        console.error("[AI-VOICE] OpenAI session setup/stream ERROR event:", {
          callSid: state.callSid,
          streamSid: state.streamSid,
          code: event?.error?.code || event?.code || null,
          message: event?.error?.message || event?.message || null,
          event,
        });
        if (event?.error?.code === "beta_api_shape_disabled") {
          console.error("[AI-VOICE] OpenAI Realtime GA setup failed: beta API shape disabled. Check session.update/response.create payloads and remove beta headers.");
        }
        try {
          const errorText = String(
            event?.error?.code ||
              event?.code ||
              event?.error?.message ||
              event?.message ||
              ""
          ).toLowerCase();
          if (errorText.includes("input_audio_buffer") || errorText.includes("commit")) {
            state.inputCommitInFlight = false;
          }
        } catch {}
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

  // ============================
  // TURN-TAKING TIMING SIGNALS
  // ============================

  if (t === "input_audio_buffer.speech_started") {
    try {
      clearSilenceWatchdog(state, "user started speaking");
      // Mark speech in progress
      state.userSpeechInProgress = true;

      // Clear any previous watchdog
      if (state.userSpeechCommitWatchdog) {
        clearTimeout(state.userSpeechCommitWatchdog);
        state.userSpeechCommitWatchdog = null;
      }

      // ✅ Clear stuck-speech watchdog
      if (state.userSpeechStuckWatchdog) {
        clearTimeout(state.userSpeechStuckWatchdog);
        state.userSpeechStuckWatchdog = null;
      }
    } catch {}

    state.lastUserSpeechStartedAtMs = Date.now();
    state.lastTranscriptDeltaAtMs = undefined;
    state.lastTranscriptCompletedAtMs = undefined;
    (state as any).listenWarmupUntilMs = 0;

    // ✅ STUCK-SPEECH FAILSAFE:
    // If OpenAI never emits speech_stopped, force a commit so the call doesn't go dead silent forever.
    try {
      state.userSpeechStuckWatchdog = setTimeout(() => {
        try {
          if (!state.userSpeechInProgress) return;
          if (!state.openAiWs || !state.openAiReady) return;
          if (state.voicemailSkipArmed) return;

          // Hard-stuck override: after 8s of "speaking" with no commit, force it regardless of flags.
          const nowForGuard = Date.now();
          const startForGuard = Number((state as any).lastUserSpeechStartedAtMs || 0);
          const hardStuckForGuard = startForGuard > 0 && (nowForGuard - startForGuard) >= 8000;

          if (!hardStuckForGuard && (state.aiSpeaking || state.waitingForResponse || (state as any).responseInFlight)) {
            console.log("[AI-VOICE][VAD] stuck-speech watchdog BLOCKED — re-arming", {
              callSid: state.callSid,
              msSinceStart: nowForGuard - startForGuard,
            });
            // Re-arm with shorter interval — will become hardStuck on next fire
            state.userSpeechStuckWatchdog = setTimeout(() => {
              try {
                if (!state.userSpeechInProgress) return;
                if (!state.openAiWs || !state.openAiReady) return;
                const now2 = Date.now();
                const start2 = Number((state as any).lastUserSpeechStartedAtMs || 0);
                const stop2 = Number((state as any).lastUserSpeechStoppedAtMs || 0);
                if (stop2 > 0 && stop2 >= start2) return;
                // After 8s total, force commit regardless of flags
                const isHardStuck2 = start2 > 0 && (now2 - start2) >= 8000;
                if (!isHardStuck2 && (state.aiSpeaking || state.waitingForResponse || (state as any).responseInFlight)) return;
                console.log("[AI-VOICE][VAD] stuck-speech FORCE-COMMIT (retry)", { callSid: state.callSid, msSinceStart: now2 - start2 });
                state.userSpeechInProgress = false;
                (state as any).lastUserSpeechStoppedAtMs = Date.now();
                sendManualInputCommit(state, "stuck-speech retry");
              } catch {}
            }, 2000);
            return;
          }

          const nowMs = Date.now();
          const startedAt = Number((state as any).lastUserSpeechStartedAtMs || 0);
          const stopAt = Number((state as any).lastUserSpeechStoppedAtMs || 0);

          if (startedAt <= 0) return;
          // Still no stop after this start
          if (stopAt > 0 && stopAt >= startedAt) return;

          // Only fire if we've been "speaking" too long (VAD stuck).
          // After 8s, force-commit regardless of flags — something is definitely stuck.
          const hardStuck = (nowMs - startedAt) >= 8000;
          if (!hardStuck && (nowMs - startedAt) < 3200) return;
          if (!hardStuck && (state.aiSpeaking || state.waitingForResponse || (state as any).responseInFlight)) return;

          console.log("[AI-VOICE][VAD] stuck-speech forcing input_audio_buffer.commit", {
            callSid: state.callSid,
            streamSid: state.streamSid,
            msSinceStart: nowMs - startedAt,
          });

          // Mark as stopped locally so downstream gating can proceed
          state.userSpeechInProgress = false;
          (state as any).lastUserSpeechStoppedAtMs = Date.now();

          sendManualInputCommit(state, "stuck-speech");

          // ✅ Re-arm watchdog in case VAD still doesn't fire speech_stopped
          state.userSpeechStuckWatchdog = setTimeout(() => {
            try {
              if (!state.userSpeechInProgress) return;
              if (!state.openAiWs || !state.openAiReady) return;
              if (state.aiSpeaking || state.waitingForResponse || (state as any).responseInFlight) return;
              state.userSpeechInProgress = false;
              (state as any).lastUserSpeechStoppedAtMs = Date.now();
              sendManualInputCommit(state, "stuck-speech rearm");
            } catch {}
          }, 3400);
        } catch {}
      }, 3400);
    } catch {}

    // ✅ Prevent stale transcript from previous turn contaminating this new utterance
    state.lastUserTranscript = "";
    try {
      if (state.lastUserTranscriptPartialByItemId) state.lastUserTranscriptPartialByItemId = {};
    } catch {}
    try {
      if ((state as any).lastUserTranscriptByItemId) (state as any).lastUserTranscriptByItemId = {};
    } catch {}
    return;
  }

  if (t === "input_audio_buffer.speech_stopped") {
    try {
      state.userSpeechInProgress = false;
      if (state.userSpeechCommitWatchdog) {
        clearTimeout(state.userSpeechCommitWatchdog);
        state.userSpeechCommitWatchdog = null;
      }
      if (state.userSpeechStuckWatchdog) {
        clearTimeout(state.userSpeechStuckWatchdog);
        state.userSpeechStuckWatchdog = null;
      }
    } catch {}

        // ✅ WATCHDOG (post-stop): If OpenAI doesn't emit committed quickly after speech_stopped,
    // force a commit *after* the user finished talking. This prevents cutoffs / incoherent turns.
    try {
      if (state.userSpeechCommitWatchdog) {
        clearTimeout(state.userSpeechCommitWatchdog);
        state.userSpeechCommitWatchdog = null;
      }
      state.userSpeechCommitWatchdog = setTimeout(() => {
        try {
          if (state.userSpeechInProgress) return; // user started talking again
          if (!state.openAiWs || !state.openAiReady) return;
          if (state.voicemailSkipArmed) return;
          // Don't force-commit during outbound or in-flight responses
          if (state.aiSpeaking || state.waitingForResponse || (state as any).responseInFlight) return;
          console.log("[AI-VOICE][VAD] post-stop forcing input_audio_buffer.commit", {
            callSid: state.callSid,
            streamSid: state.streamSid,
          });
          sendManualInputCommit(state, "post-stop");
        } catch {}
      }, 450);
    } catch {}

state.lastUserSpeechStoppedAtMs = Date.now();
    return;
  }



  try {
    const typeLower = String(event?.type || "").toLowerCase();

    // ✅ Realtime input audio transcription (delta + completed)
    // OpenAI may send:
    // - conversation.item.input_audio_transcription.delta { item_id, delta }
    // - conversation.item.input_audio_transcription.completed { item_id, transcript }
    // - conversation.item.input_audio_transcription.failed { item_id }
    //
    // We aggregate deltas per item_id and finalize on completed. We also keep
    // a best-effort fallback for other transcription-ish events.
    const isItemTranscriptionEvent =
      typeLower === "conversation.item.input_audio_transcription.delta" ||
      typeLower === "conversation.item.input_audio_transcription.completed" ||
      typeLower === "conversation.item.input_audio_transcription.failed";

    if (isItemTranscriptionEvent) {
      const itemId = String((event as any)?.item_id || "").trim();
      if (!state.lastUserTranscriptByItemId) state.lastUserTranscriptByItemId = {};
      if (!state.lastUserTranscriptPartialByItemId) state.lastUserTranscriptPartialByItemId = {};

      if (typeLower === "conversation.item.input_audio_transcription.delta") {
        const d = String((event as any)?.delta || "").trim();
        if (itemId && d) {
          state.lastTranscriptDeltaAtMs = Date.now();
          const prev = state.lastUserTranscriptPartialByItemId[itemId] || "";
          const next = (prev + d).replace(/\s+/g, " ").trim();
          state.lastUserTranscriptPartialByItemId[itemId] = next;
          state.lastUserTranscript = next;

          // ✅ FIX: delta arrives before completed; if we are waiting on a committed turn,
          // replay immediately once we have *any* text.
          try {
            const pending = (state as any).pendingCommittedTurn;

            const got = String(next || "").trim();
            if (
              pending &&
              got &&
              !state.aiSpeaking &&
              !state.waitingForResponse &&
              !state.responseInFlight &&
              state.openAiWs &&
              state.openAiReady &&
              !state.voicemailSkipArmed
            ) {
              pending.bestTranscript = mergeDeferredTurnText(pending.bestTranscript || state.deferredTurnTranscript || "", got);
              void replayPendingCommittedTurn(twilioWs, state, "transcript delta");
            }
          } catch {}
        }
      } else if (typeLower === "conversation.item.input_audio_transcription.completed") {
        const tr = String((event as any)?.transcript || "").trim();
        if (itemId && tr) {
          state.lastTranscriptCompletedAtMs = Date.now();
          const clean = tr.replace(/\s+/g, " ").trim();
          state.lastUserTranscriptByItemId[itemId] = clean;
          state.lastUserTranscriptPartialByItemId[itemId] = "";
          state.lastUserTranscript = clean;
          // ✅ FIX: If a user turn was committed before transcription arrived,
          // replay it as soon as we have ANY transcript text (delta or completed).
          try {
            const pending = (state as any).pendingCommittedTurn;

            const got = String(clean || "").trim();
            if (
              pending &&
              got &&
              !state.aiSpeaking &&
              !state.waitingForResponse &&
              !state.responseInFlight &&
              state.openAiWs &&
              state.openAiReady &&
              !state.voicemailSkipArmed
            ) {
              pending.bestTranscript = mergeDeferredTurnText(pending.bestTranscript || state.deferredTurnTranscript || "", got);
              void replayPendingCommittedTurn(twilioWs, state, "transcript completed");
            }
          } catch {}
        }
      } else {
        if (itemId && state.lastUserTranscriptPartialByItemId) {
          state.lastUserTranscriptPartialByItemId[itemId] = "";
        }
      }
    } else {
      // ✅ Best-effort fallback for other transcription events.
      // We do NOT depend on these existing; they vary by model/settings.
      const looksInputTranscription =
        typeLower.includes("input_audio_transcription") ||
        typeLower.includes("input.transcription") ||
        typeLower.includes("conversation.item.input_audio_transcription");

      if (looksInputTranscription) {
        const maybeText =
          (event as any)?.transcript ||
          (event as any)?.text ||
          (event as any)?.item?.transcript ||
          (event as any)?.item?.text ||
          (event as any)?.delta?.transcript ||
          (event as any)?.delta?.text ||
          (event as any)?.input_audio_transcription?.text ||
          (event as any)?.input_audio_transcription?.transcript ||
          "";

        if (typeof maybeText === "string" && maybeText.trim()) {
          state.lastUserTranscript = maybeText.trim();
        }
      }
    }
  } catch {}

  if (t === "session.updated" && !state.openAiConfigured) {
    state.openAiConfigured = true;
    state.openAiReady = true;

    state.phase = "awaiting_greeting_reply";

    try {
      console.log("[AI-VOICE][PROMPT-APPLIED]", {
        callSid: state.callSid,
        streamSid: state.streamSid,
        scriptKey: normalizeScriptKey(state.context?.scriptKey),
        openAiVoiceId: state.context?.voiceProfile?.openAiVoiceId,
        systemPromptLen: state.systemPromptLen,
        markers: state.systemPromptMarkers,
        uniqueLine: (state.systemPromptUniqueLine || "").slice(0, 180),
      });
    } catch {}

    if (state.pendingAudioFrames.length > 0) {

      // ✅ FIX: keep a small tail of early caller audio so we don't drop their initial "hello".

      // This is bounded (~500ms) and does NOT increase ongoing cost.

      const keepN = 25; // 25 * 20ms = 500ms

      const kept = state.pendingAudioFrames.slice(-keepN);

      const dropped = Math.max(0, state.pendingAudioFrames.length - kept.length);

      (state as any).preGreetingFrames = kept;

      state.pendingAudioFrames = [];

      console.log("[AI-VOICE] Keeping buffered inbound frames before greeting", { kept: kept.length, dropped });

    }

    try {
      state.openAiWs?.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
      // ✅ Do NOT replay pre-greeting frames. They cause spurious speech_started/committed
      // sequences that trigger the greeting retry loop. Real speech after greeting plays
      // will be captured by live VAD naturally.
      (state as any).preGreetingFrames = [];
    } catch {}

    if (
      !state.waitingForResponse &&
      !state.initialGreetingQueued &&
      state.openAiWs
    ) {
      state.initialGreetingQueued = true;

      (async () => {
        const inboundFlow = shouldUseInboundFlow(state.context);
        const existing = String(state.context?.answeredBy || "").trim();
        const amdChecks = inboundFlow || existing
          ? Promise.resolve()
          : (async () => {
              await Promise.all([
                refreshAnsweredByFromCoveCRM(state, "pre-greeting #1"),
                refreshAnsweredByFromCoveCRM(state, "pre-greeting #2"),
              ]);
              await sleep(200);
              await refreshAnsweredByFromCoveCRM(state, "pre-greeting #3");
            })().catch(() => {});

        await Promise.race([amdChecks, sleep(700)]);

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

        if (!inboundFlow && (!answeredByNow || answeredByNow === "unknown")) {
          console.log("[AI-VOICE] AMD unresolved after bounded pre-greeting check — proceeding", {
            callSid: state.callSid,
            answeredByNow,
          });
        }

        const liveState = calls.get(twilioWs);
        if (
          !liveState ||
          !liveState.openAiWs ||
          liveState.waitingForResponse ||
          !liveState.openAiReady
        ) {
          return;
        }

        // ✅ FIX: If the caller is already speaking (very common right at connect),
        // do NOT fire the greeting yet. Wait briefly for speech to stop so we don't talk over them.
        try {
          for (let i = 0; i < 2; i++) {
            const startedAt = Number((liveState as any).lastUserSpeechStartedAtMs || 0);
            const stopAt = Number((liveState as any).lastUserSpeechStoppedAtMs || 0);
            const now = Date.now();
            const userSpeaking = startedAt > 0 && (stopAt <= 0 || stopAt < startedAt) && (now - startedAt) <= 5000;
            if (!userSpeaking) break;
            await sleep(100);
          }
        } catch {}

        liveState.userAudioMsBuffered = 0;
        liveState.lastUserTranscript = "";
        liveState.lowSignalCommitCount = 0;
        liveState.repromptCountForCurrentStep = 0;

        // ✅ reset turn guards
        liveState.bargeInDetected = false;
        liveState.bargeInFrames = [];
        liveState.bargeInAudioMsBuffered = 0;

        setWaitingForResponse(liveState, true, "response.create (greeting)");
        setAiSpeaking(liveState, true, "response.create (greeting)");
        setResponseInFlight(liveState, true, "response.create (greeting)");
        liveState.outboundOpenAiDone = false;

        const aiName = (liveState.context!.voiceProfile.aiName || "Alex").trim() || "Alex";
        const clientNameRaw = (liveState.context!.clientFirstName || "").trim();
        const clientName = (!clientNameRaw || isTestOrPlaceholderName(clientNameRaw)) ? "there" : clientNameRaw;
        const greetingLine = `Hey ${clientName}. This is ${aiName}. Can you hear me alright?`;
        // Greeting instruction: dead simple — say the line, stop, wait. No history/goals scaffolding.
        let greetingInstr: string;
        if ((liveState as any).rebookingMode) {
          const rbAgentFirst = String((liveState as any).rebookingAgentFirst || "our agent");
          const rbLeadName   = String((liveState as any).rebookingLeadName   || "");
          const rbOpenLine   = rbLeadName
            ? `Hey ${rbLeadName}, I tried to connect you with ${rbAgentFirst} but it looks like they just stepped into another call.`
            : `I tried to connect you with ${rbAgentFirst} but it looks like they just stepped into another call.`;
          greetingInstr = `Say exactly: "${rbOpenLine} Does later today or tomorrow work better for ${rbAgentFirst} to give you a call?" — say this warmly and naturally. After saying it, stop and wait for their response.`;
          // Put call into post-coverage scheduling state immediately
          (liveState as any).lastRouteKind        = "policy_step1_coverage";
          (liveState as any).scriptStepIndex      = 1;
          (liveState as any).awaitingUserAnswer   = true;
          if (liveState.context) {
            (liveState.context as any).liveTransferEnabled = false;
          }
        } else {
          greetingInstr = shouldUseInboundFlow(liveState.context)
            ? buildInboundGreetingInstructions(liveState.context!)
            : buildGreetingInstructions(liveState.context!);
        }

        try {
          if (!liveState.debugLoggedResponseCreateGreeting) {
            liveState.debugLoggedResponseCreateGreeting = true;
            console.log("[AI-VOICE][RESPONSE-CREATE][GREETING]", {
              callSid: liveState.callSid,
              streamSid: liveState.streamSid,
              scriptKey: normalizeScriptKey(liveState.context?.scriptKey),
              phase: liveState.phase,
              instructionLen: greetingInstr.length,
            });
          }
        } catch {}

        liveState.lastPromptSentAtMs = Date.now();
        liveState.lastPromptLine = "GREETING";
        liveState.lastResponseCreateAtMs = Date.now();

        liveState.openAiWs.send(
          JSON.stringify(buildRealtimeResponseCreate(greetingInstr))
        );

      })();
    }

    return;
  }

  if (t === "input_audio_buffer.cleared") {
    state.inputCommitInFlight = false;
    return;
  }

  if (t === "input_audio_buffer.committed") {
    state.inputCommitInFlight = false;
    try {
      if (state.userSpeechCommitWatchdog) {
        clearTimeout(state.userSpeechCommitWatchdog);
        state.userSpeechCommitWatchdog = null;
      }
      if (state.userSpeechStuckWatchdog) {
        clearTimeout(state.userSpeechStuckWatchdog);
        state.userSpeechStuckWatchdog = null;
      }
    } catch {}


    // ✅ Guard: ignore ALL commits until greeting audio has FINISHED playing.
    // greetingAudioDone is set on response.audio.done for the greeting response.
    // This is the only safe gate — greetingAudioStarted (first delta) fires too early
    // because pre-greeting buffered frames can commit in the same tick as the first delta.
    if (state.phase === "awaiting_greeting_reply" && !(state as any).greetingAudioDone) {
      console.log("[AI-VOICE][TURN-GATE] ignoring pre-greeting commit (greeting audio not done yet)", {
        callSid: state.callSid,
        greetingAudioStarted: !!(state as any).greetingAudioStarted,
        greetingAudioDone: !!(state as any).greetingAudioDone,
      });
      return;
    }

    if (state.voicemailSkipArmed) return;
    if (!state.openAiWs || !state.openAiReady) return;
    // ✅ BEST transcript selection (smooth gating)
    // Prefer completed per-item transcript if present; else partial; else lastUserTranscript.
    // This avoids reacting to empty/noisy commits and keeps turn-taking natural.
    let bestTranscript = "";
    try {
      const byId = (state.lastUserTranscriptByItemId || {}) as Record<string,string>;
      const partialById = (state.lastUserTranscriptPartialByItemId || {}) as Record<string,string>;

      // pick the most recently updated entry (best-effort: last key iteration)
      const ids = Object.keys(byId);
      if (ids.length) {
        const lastId = ids[ids.length - 1];
        bestTranscript = String(byId[lastId] || "").trim();
      }

      if (!bestTranscript) {
        const pids = Object.keys(partialById);
        if (pids.length) {
          const lastPid = pids[pids.length - 1];
          bestTranscript = String(partialById[lastPid] || "").trim();
        }
      }

      if (!bestTranscript) bestTranscript = String(state.lastUserTranscript || "").trim();
      bestTranscript = bestTranscript.replace(/\s+/g, " ").trim();
    } catch {}

    // Instrument once per process if needed (safe + tiny)
    if (!(state as any).__bestTranscriptLogOnce) {
      (state as any).__bestTranscriptLogOnce = true;
      console.log("[AI-VOICE][TURN-GATE][BEST-TRANSCRIPT]", {
        callSid: state.callSid,
        hasBestTranscript: !!bestTranscript,
        bestLen: bestTranscript ? bestTranscript.length : 0,
      });
    }

    // ✅ If commit is too small AND transcript is empty, do nothing and wait.
    // This prevents the AI from "jumping in" on comfort noise / micro-utterances.
    const audioMsCommitGate = Number(state.userAudioMsBuffered || 0);
    const tooLittleAudio = audioMsCommitGate < 280; // <~0.28s is usually not a real answer
    const tooLittleText = !bestTranscript || bestTranscript.length < 2;

    if (tooLittleText && tooLittleAudio) {
      // Keep counting low-signal commits, but do not respond yet.
      // BUT: if the user actually spoke and transcription is late, arm a pending turn
      // so the delta/completed transcription handler can replay immediately when text arrives.
      try {
        const nowMs = Date.now();
        const startMs = Number(state.lastUserSpeechStartedAtMs || 0);
        const stopMs = Number(state.lastUserSpeechStoppedAtMs || 0);
        const spokeDurationMs = (startMs > 0 && stopMs > 0) ? (stopMs - startMs) : 0;
        const stoppedRecently = stopMs > 0 && (nowMs - stopMs) <= 1500;

        // Only arm pending when it looks like a real utterance (not comfort noise).
        // We intentionally do NOT rely only on userAudioMsBuffered (it can be 0 in some cases).
        const looksLikeRealUtterance = stoppedRecently && spokeDurationMs >= 250;

        if (looksLikeRealUtterance && !state.pendingCommittedTurn) {
          state.pendingCommittedTurn = {
            bestTranscript: "",
            audioMs: Number(audioMsCommitGate || 0),
            atMs: nowMs,
          };

          // Safety cleanup: if transcript never arrives, clear the pending after ~2s.
          setTimeout(() => {
            try {
              if (!state.pendingCommittedTurn) return;
              const stillEmpty = !String(state.pendingCommittedTurn.bestTranscript || "").trim();
              const age = Date.now() - Number(state.pendingCommittedTurn.atMs || 0);
              if (stillEmpty && age >= 1800) state.pendingCommittedTurn = null;
            } catch {}
          }, 2000);
        }
      } catch {}

      state.lowSignalCommitCount = (state.lowSignalCommitCount || 0) + 1;
      return;
    }


    // ✅ TRANSCRIPT-LATE FAST PATH (mid-signal)
    // If commit fires before any transcript text exists, do NOT treat it as filler.
    // Arm a pending turn so transcription delta/completed can replay immediately when text arrives.
    const hasAnyTextNow = !!String(bestTranscript || state.lastUserTranscript || "").trim();

    if (!hasAnyTextNow) {
      let looksLikeRealUtterance = false;

      try {
        const nowMs = Date.now();
        const startMs = Number(state.lastUserSpeechStartedAtMs || 0);
        const stopMs = Number(state.lastUserSpeechStoppedAtMs || 0);
        const spokeDurationMs =
          startMs > 0 && stopMs > 0 ? (stopMs - startMs) : 0;
        const stoppedRecently = stopMs > 0 && (nowMs - stopMs) <= 1500;

        // Only arm pending when it looks like a real utterance (not comfort noise).
        // We intentionally do NOT rely only on userAudioMsBuffered (it can be 0 in some cases).
        looksLikeRealUtterance = stoppedRecently && spokeDurationMs >= 250;

        if (looksLikeRealUtterance && !state.pendingCommittedTurn) {
          state.pendingCommittedTurn = {
            bestTranscript: "",
            audioMs: Number(audioMsCommitGate || 0),
            atMs: nowMs,
          };

          // Safety cleanup: if transcript never arrives, clear the pending after ~2s.
          setTimeout(() => {
            try {
              if (!state.pendingCommittedTurn) return;
              const stillEmpty = !String(
                state.pendingCommittedTurn.bestTranscript || ""
              ).trim();
              const age =
                Date.now() - Number(state.pendingCommittedTurn.atMs || 0);
              if (stillEmpty && age >= 1800) state.pendingCommittedTurn = null;
            } catch {}
          }, 2000);
        }
      } catch {}

      // If it looks like they spoke a real utterance but transcript is late, wait for delta/completed replay.
      if (looksLikeRealUtterance) {
        return;
      }
    }

    // ✅ FILLER GRACE WINDOW (um/uh/what + short pause)
    // If they say "um/uh/what/sorry" and pause briefly, do NOT reprompt immediately.
    // Hold the commit for a short grace window to see if they continue speaking.
    const isFillerTranscript = (txt: string): boolean => {
      const t = String(txt || "").trim().toLowerCase();
      if (!t) return true;
      const cleaned = t.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      if (!cleaned) return true;

      // Single-token filler
      if (cleaned.length <= 5) {
        return ["um","uh","er","ah","hm","hmm","what","huh","sorry","wait"].includes(cleaned);
      }

      // Common short phrases
      if (cleaned.length <= 20) {
        const phrases = new Set([
          "hold on",
          "one sec",
          "one second",
          "wait a sec",
          "wait a second",
          "what was that",
          "say that again",
        ]);
        if (phrases.has(cleaned)) return true;
      }

      return false;
    };

    const filler = isFillerTranscript(bestTranscript || String(state.lastUserTranscript || ""));
    const fillerAudioMs = Number(audioMsCommitGate || 0);

    // ✅ If a real (non-filler) commit arrives while a filler timer is pending, cancel it and proceed.
    if (!filler && (state as any).pendingFillerTimer) {
      clearTimeout((state as any).pendingFillerTimer);
      (state as any).pendingFillerTimer = null;
      (state as any).pendingFillerCommit = null;
      console.log("[AI-VOICE][FILLER] cancelled pending filler timer — real transcript arrived", {
        callSid: state.callSid,
        transcript: bestTranscript,
      });
    }

    // Only apply grace when it's not a real answer (filler) and not strong audio.
    if (filler && fillerAudioMs < 1700) {
      try {
        // If we already have a pending filler commit, replace it with the newest one.
        (state as any).pendingFillerCommit = {
          bestTranscript: String(bestTranscript || state.lastUserTranscript || "").trim(),
          audioMs: fillerAudioMs,
          atMs: Date.now(),
        };

        // Clear any existing timer and restart (latest commit wins)
        if ((state as any).pendingFillerTimer) {
          clearTimeout((state as any).pendingFillerTimer);
        }

        (state as any).pendingFillerTimer = setTimeout(() => {
          try {
            (state as any).pendingFillerTimer = null;

            // If we no longer have a pending filler commit, nothing to do.
            if (!(state as any).pendingFillerCommit) return;

            // Don't fire while model is busy.
            if (state.aiSpeaking) return;
            if (state.waitingForResponse || state.responseInFlight) return;

            // Best effort: use any transcript we have by now.
            const latest = String(state.lastUserTranscript || "").trim();

            // If it's STILL just filler after the grace window, do nothing (wait for user to continue).
            // This prevents the assistant from "cutting off" after a short pause on "um/uh/hold on".
            try {
              const check = String(latest || (state as any).pendingFillerCommit?.bestTranscript || "").trim();
              const cleaned = check.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
              const phrases = new Set([
                "hold on","one sec","one second","wait a sec","wait a second","what was that","say that again",
              ]);
              const isFillerStill =
                !cleaned ||
                (cleaned.length <= 5 && ["um","uh","er","ah","hm","hmm","what","huh","sorry","wait"].includes(cleaned)) ||
                (cleaned.length <= 20 && phrases.has(cleaned));

              if (isFillerStill) {
                // ✅ Don't silently drop — replay so stepper can reprompt rather than going silent.
                state.pendingCommittedTurn = (state as any).pendingFillerCommit;
                (state as any).pendingFillerCommit = null;
                void replayPendingCommittedTurn(twilioWs, state, "filler grace expired - still filler, reprompt");
                return;
              }
            } catch {}

            // Promote filler commit into the normal pendingCommittedTurn pipeline and replay.
            state.pendingCommittedTurn = (state as any).pendingFillerCommit;
            (state as any).pendingFillerCommit = null;

            if (latest && state.pendingCommittedTurn) {
              state.pendingCommittedTurn.bestTranscript = latest;
            }

            void replayPendingCommittedTurn(twilioWs, state, "filler grace expired");
          } catch {}
        }, 750);
      } catch {}

      // IMPORTANT: do NOT process this commit yet.
      return;
    }

    // ✅ Use bestTranscript as the canonical lastUserTranscript for this turn

    if (bestTranscript) state.lastUserTranscript = bestTranscript;

    if (state.transferStarting || state.transferInProgress) {
      state.pendingCommittedTurn = null;
      try {
        console.log("[AI-VOICE][LIVE-TRANSFER] committed turn ignored while transfer is starting", {
          callSid: state.callSid,
          transferStarting: !!state.transferStarting,
          transferInProgress: !!state.transferInProgress,
        });
      } catch {}
      return;
    }

    // ✅ If commit fires before transcription arrives, avoid using stale lastUserTranscript.
    // Queue and replay shortly to capture the real transcript (e.g., objections like 'taken care of').
    try {
      const nowMs = Date.now();
      const hasTextNow = !!String(state.lastUserTranscript || "").trim();
      const recentStopMs = Number(state.lastUserSpeechStoppedAtMs || 0);
      const stoppedRecently = recentStopMs > 0 && (nowMs - recentStopMs) <= 1500;
      const audioStrong = Number(audioMsCommitGate || 0) >= 1400;
      if (!bestTranscript && !hasTextNow && stoppedRecently && audioStrong) {
        state.pendingCommittedTurn = {
          bestTranscript: "",
          audioMs: Number(audioMsCommitGate || 0),
          atMs: nowMs,
        };
        setTimeout(() => {
          try {
            if (!state.pendingCommittedTurn) return;
            if (state.aiSpeaking) return;
            if (state.waitingForResponse || state.responseInFlight) return;
            const latest = String(state.lastUserTranscript || "").trim();
            if (latest) state.pendingCommittedTurn.bestTranscript = latest;
            void replayPendingCommittedTurn(twilioWs, state, "await transcript");
          } catch {}
        }, 250);
        return;
      }
    } catch {}
    // ✅ Hard guard: never create while a response is in flight / still waiting (prevents double fire)
    // IMPORTANT: do NOT drop/consume the user turn. Queue it and replay when safe.
    if (state.responseInFlight || state.waitingForResponse) {
      state.pendingCommittedTurn = {
        bestTranscript: String(state.lastUserTranscript || bestTranscript || "").trim(),
        audioMs: Number(audioMsCommitGate || 0),
        atMs: Date.now(),
      };
      try {
        console.log("[AI-VOICE][TURN-GATE] queued commit while response active", {
          callSid: state.callSid,
          streamSid: state.streamSid,
          queuedLen: state.pendingCommittedTurn.bestTranscript
            ? state.pendingCommittedTurn.bestTranscript.length
            : 0,
          queuedAudioMs: state.pendingCommittedTurn.audioMs,
          responseInFlight: !!state.responseInFlight,
          waitingForResponse: !!state.waitingForResponse,
        });
      } catch {}
      return;
    }

    // ✅ IMPORTANT: Do NOT drop/consume the user turn while the pacer is still draining.
    // Greeting often finishes at OpenAI (response.audio.done) while aiSpeaking stays true until the outbound
    // buffer drains. If we consume awaitingUserAnswer and return here, we get post-greeting dead silence.
    // ✅ NEVER drop user turns.
    // If the user commits while outbound audio is still draining, queue it and replay when pacer drains.
    if (state.aiSpeaking) {
      state.pendingCommittedTurn = {
        bestTranscript: String(state.lastUserTranscript || bestTranscript || "").trim(),
        audioMs: Number(audioMsCommitGate || 0),
        atMs: Date.now(),
      };
      try {
        console.log("[AI-VOICE][TURN-GATE] queued commit while aiSpeaking", {
          callSid: state.callSid,
          streamSid: state.streamSid,
          queuedLen: state.pendingCommittedTurn.bestTranscript
            ? state.pendingCommittedTurn.bestTranscript.length
            : 0,
          queuedAudioMs: state.pendingCommittedTurn.audioMs,
        });
      } catch {}
      return;
    }

    // ✅ IMPORTANT: Do NOT clear awaitingUserAnswer unless we actually accept a real answer
    // OR we are about to speak. Low-signal commits must NOT clear awaitingUserAnswer, otherwise
    // subsequent commits can be ignored and the stepper can skip ahead.

    const isGreetingReply = state.phase === "awaiting_greeting_reply";

    if (!state.scriptSteps || state.scriptSteps.length === 0) {
      try {
        const selectedScript = getSelectedScriptText(state.context!);
        state.scriptSteps = extractScriptStepsFromSelectedScript(selectedScript);
        state.scriptStepIndex = 0;
      } catch {
        state.scriptSteps = [];
        state.scriptStepIndex = 0;
      }
    }

    const idx =
      typeof state.scriptStepIndex === "number" ? state.scriptStepIndex : 0;
    const steps = state.scriptSteps || [];

    let lastUserText = String(state.lastUserTranscript || "").trim();
    const turnFinalization = shouldDeferTurnRouting(state, lastUserText, "main", {
      audioMs: audioMsCommitGate,
    });
    if (turnFinalization.defer) {
      state.pendingCommittedTurn = {
        bestTranscript: turnFinalization.transcript,
        audioMs: Number(audioMsCommitGate || 0),
        atMs: Date.now(),
      };
      state.lastUserTranscript = turnFinalization.transcript;
      return;
    }
    lastUserText = turnFinalization.transcript;
    if (lastUserText) state.lastUserTranscript = lastUserText;
    const objectionKind = !isGreetingReply && lastUserText ? detectObjection(lastUserText) : null;

    const questionKind = !isGreetingReply && !objectionKind && lastUserText ? detectQuestionKindForTurn(lastUserText) : null;
    const objectionOrQuestionKind = objectionKind || questionKind;

    const currentStepLine = steps[idx] || getBookingFallbackLine(state.context!);

    // ✅ FIX: The user is answering the LAST asked step, not the NEXT step-to-say.
    // idx = next script line we will say.
    // expectedAnswerIdx = step we most recently asked (usually idx-1).
    const expectedAnswerIdx = Math.max(0, idx - 1);
    const expectedStepLine = steps[expectedAnswerIdx] || currentStepLine;
    const stepType = classifyStepType(expectedStepLine);

    // ✅ small human pause like ChatGPT voice (only when we are about to speak)
    const humanPause = async () => {
      try {
        await sleep(randInt(120, 220));
      } catch {}
    };

    // anti-spam: if somehow we are firing too quickly, block
    const now = Date.now();
    const lastCreateAt = Number(state.lastResponseCreateAtMs || 0);
    if (now - lastCreateAt < 150) return;
    const turnKey = buildCommittedTurnKey(state, lastUserText, audioMsCommitGate, expectedAnswerIdx);
    if (shouldSkipShortWindowDuplicateTurn(state, lastUserText, expectedAnswerIdx)) return;

    if (await handleConversationTurn(state, lastUserText, "main", { idx, steps, stepType, expectedAnswerIdx }, turnKey, humanPause)) return;

    if (state.pendingLiveTransferAvailabilityConfirm) {
      const _ltClearSd = String(state.selectedDay || "").trim().toLowerCase();
      const _ltClearExplicit = extractExplicitDaySelection(lastUserText);
      if (objectionOrQuestionKind || _ltClearSd === "today" || _ltClearSd === "tomorrow" || _ltClearExplicit === "today" || _ltClearExplicit === "tomorrow") {
        state.pendingLiveTransferAvailabilityConfirm = false;
        state.pendingLiveTransferAvailabilityAttempts = 0;
      } else {
      if (!markCommittedTurnHandled(state, turnKey, "live-transfer availability")) return;
      const explicitDay = extractExplicitDaySelection(lastUserText);
      const rememberedDay = String(state.selectedDay || "").trim().toLowerCase();
      const selectedAvailabilityDay =
        explicitDay === "today" || explicitDay === "tomorrow"
          ? explicitDay
          : rememberedDay === "today" || rememberedDay === "tomorrow"
            ? (rememberedDay as "today" | "tomorrow")
            : null;
      const immediateYes = hasImmediateTransferConfirmation(lastUserText);
      const schedulingPreference = isImmediateTransferSchedulingPreference(lastUserText);
      const yesNow = !selectedAvailabilityDay && (immediateYes || (isLiveTransferAvailabilityYes(lastUserText) && !schedulingPreference));
      const noLater = !yesNow && (!!selectedAvailabilityDay || schedulingPreference || isLiveTransferAvailabilityNo(lastUserText));
      try {
        console.log("[AI-VOICE][LIVE-TRANSFER-INTENT]", {
          source: "main",
          yesNow,
          noLater,
          explicitDay: explicitDay || null,
          reason: yesNow ? "immediate_transfer" : noLater ? "scheduling_preference" : "ambiguous",
        });
      } catch {}
      const nextAvailabilityAttempts = !yesNow && !noLater
        ? Number(state.pendingLiveTransferAvailabilityAttempts || 0) + 1
        : 0;
      const escapeAvailabilityLoop = !yesNow && !noLater && nextAvailabilityAttempts >= 3;
      const userAlreadySaidWhen = isDayReferenceMentioned(lastUserText) || isTimeWindowMentioned(lastUserText);
      if (selectedAvailabilityDay) {
        state.selectedDay = selectedAvailabilityDay;
      }
      let lineToSay = yesNow
        ? getLiveTransferTryingLine(state.context!)
        : noLater || escapeAvailabilityLoop
          ? noLater || userAlreadySaidWhen
            ? getTimeOfferLine(state.context!, 0, selectedAvailabilityDay || pickDayHint(lastUserText, ""), pickTimeWindowHint(lastUserText, ""), lastUserText)
            : "No problem. Would later today or tomorrow be better?"
          : getLiveTransferAvailabilityLine(state.context!);
      const _guard_mplt = applyAiOutputRepeatGuard(state, lineToSay, {
        userText: lastUserText,
        routeKind: yesNow ? "live_transfer_try" : noLater ? "time_offer" : "live_transfer_availability",
        objective: yesNow ? "transfer_now" : "schedule_time",
      });
      lineToSay = _guard_mplt.lineToSay;
      for (const [k, v] of Object.entries(_guard_mplt.stateWrites)) { (state as any)[k] = v; }
      const instr = buildExactScriptLineInstruction(lineToSay, {
        userText: lastUserText || "",
        recentExchanges: state.recentExchanges,
        scope: state.context ? getScopeLabelForScriptKey(state.context.scriptKey) : "life insurance",
        agent: state.context ? (state.context.agentName || "the agent").split(" ")[0] : "the agent",
        leadName: state.context ? (state.context.clientFirstName || "there") : "there",
      });

      if (lastUserText) pushExchange(state, "user", lastUserText, expectedAnswerIdx);
      pushExchange(state, "ai", lineToSay, expectedAnswerIdx);

      state.pendingLiveTransferAvailabilityConfirm = !yesNow && !noLater && !escapeAvailabilityLoop;
      state.pendingLiveTransferAvailabilityAttempts = state.pendingLiveTransferAvailabilityConfirm ? nextAvailabilityAttempts : 0;
      state.awaitingUserAnswer = false;
      state.awaitingAnswerForStepIndex = undefined;
      state.userAudioMsBuffered = 0;
      state.lastUserTranscript = "";
      state.lowSignalCommitCount = 0;
      state.repromptCountForCurrentStep = 0;

      setWaitingForResponse(state, true, yesNow ? "response.create (live-transfer try)" : "response.create (live-transfer later)");
      setAiSpeaking(state, true, yesNow ? "response.create (live-transfer try)" : "response.create (live-transfer later)");
      setResponseInFlight(state, true, yesNow ? "response.create (live-transfer try)" : "response.create (live-transfer later)");
      state.outboundOpenAiDone = false;
      state.lastPromptSentAtMs = Date.now();
      state.lastPromptLine = lineToSay;
      state.lastResponseCreateAtMs = Date.now();
      recordPassiveRouteMemory(state, {
        source: "main",
        routeKind: _guard_mplt.routeKind,
        routeReason: yesNow ? "availability_yes" : noLater ? "availability_no" : escapeAvailabilityLoop ? "availability_escape" : "availability_ambiguous",
        userText: lastUserText,
        lineToSay,
        turnKey,
      });
      noteAiOutputSpoken(state, lineToSay);
      state.openAiWs.send(JSON.stringify(buildRealtimeResponseCreate(instr)));

      state.phase = "in_call";
      if (yesNow) {
        state.liveTransferIntroSpoken = true;
        state.pendingLiveTransferAfterLine = true;
      } else if (noLater || escapeAvailabilityLoop) {
        state.scriptStepIndex = Math.min(idx + 1, Math.max(0, steps.length - 1));
        state.awaitingUserAnswer = true;
        state.awaitingAnswerForStepIndex = Math.max(0, state.scriptStepIndex - 1);
        if (userAlreadySaidWhen) {
          state.timeOfferCountForStepIndex = state.scriptStepIndex;
          state.timeOfferCount = 1;
        }
      } else {
        // Fallthrough: ambiguous response (e.g. "what?") — re-ask the same availability question.
        // Re-arm so the next commit is accepted and routed back into this block.
        state.awaitingUserAnswer = true;
        state.awaitingAnswerForStepIndex = expectedAnswerIdx;
      }
      return;
      }
    }


  }


  if (t === "response.audio.delta" || t === "response.output_audio.delta") {
    if (state.voicemailSkipArmed) return;

    // ✅ Guard: ignore late/tail audio deltas after cancel/done.
    // Without this, a late delta can resurrect aiSpeaking=true after response.cancel.
    if (state.responseInFlight !== true || state.outboundOpenAiDone === true) {
      return;
    }

    if (!state.aiAudioStartedAtMs) {
      state.aiAudioStartedAtMs = Date.now();
      // Fresh response is now audibly speaking; reset barge-in counters for clean measurement.
      state.bargeInDetected = false;
      state.bargeInAudioMsBuffered = 0;
      state.bargeInFrames = [];

      // ✅ Voicemail mid-call check: 3s after first audio delta, re-check AMD.
      // Twilio AMD can be slow to resolve. If it comes back "machine" after greeting starts,
      // we stop immediately rather than leaving a full voicemail.
      if (!state.voicemailSkipArmed && !(state as any).voicemailMidCallCheckDone) {
        (state as any).voicemailMidCallCheckDone = true;
        setTimeout(async () => {
          try {
            const live = calls.get(twilioWs);
            if (!live || live.phase === "ended" || live.voicemailSkipArmed) return;
            const answeredBy = await refreshAnsweredByFromCoveCRM(live, "mid-call AMD check");
            if (isVoicemailAnsweredBy(answeredBy)) {
              console.log("[AI-VOICE][VOICEMAIL] mid-call AMD detected — hanging up", {
                callSid: live.callSid,
                answeredBy,
              });
              live.voicemailSkipArmed = true;
              // Send final_outcome as no_answer before closing
              if (!live.finalOutcomeSent && live.context) {
                live.finalOutcomeSent = true;
                void handleFinalOutcomeIntent(live, {
                  kind: "final_outcome",
                  outcome: "no_answer",
                  summary: "Voicemail detected mid-call via AMD.",
                  notesAppend: `answeredBy: ${answeredBy}. Call ended automatically.`,
                }).catch(() => {});
              }
              safelyCloseOpenAi(live, "voicemail detected mid-call");
            }
          } catch {}
        }, 3000);
      }

    }

    setAiSpeaking(state, true, `OpenAI ${t} (audio delta)`);

    let payloadBase64: string | undefined;

    if (typeof event.delta === "string") payloadBase64 = event.delta;
    else if (event.delta && typeof event.delta.audio === "string") {
      payloadBase64 = event.delta.audio as string;
    }

    if (payloadBase64) {
      // ✅ OpenAI is configured to return g711_ulaw now (Twilio-ready). Do NOT convert.
      const mulawBytes = Buffer.from(payloadBase64, "base64");

      if (!state.debugLoggedFirstOutputAudio) {
        console.log("[AI-VOICE] First OpenAI audio delta received", {
          streamSid,
          ulawB64Len: payloadBase64.length,
          ulawBytesLen: mulawBytes.length,
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

  // ✅ IMPORTANT: Only finalize the response when AUDIO is done (or we cancelled/interrupted).
  // response.done/response.completed/output_item.done can arrive before the final audio deltas.
  // If we flip outboundOpenAiDone early, the guard above will drop remaining audio and cut off mid-sentence.
  const isAudioDone = t === "response.audio.done" || t === "response.output_audio.done";
  const isTerminalNoMoreAudio = t === "response.cancelled" || t === "response.interrupted";
  const shouldFinalize = isAudioDone || isTerminalNoMoreAudio;

  if (shouldFinalize) {
    if (isAudioDone) {
      state.lastAiDoneAtMs = Date.now();

      // ✅ Mark greeting audio as done so commits can be processed.
      // We set this on ANY audio.done while in awaiting_greeting_reply phase.
      // This covers both the initial greeting and any retry greeting.
      // ✅ Mark greeting done if we are in greeting phase OR greeting advance is pending
      // (greetingAdvancePending means we fired the greeting but phase may shift on first delta)
      // ✅ Set greetingAudioDone on the first response.audio.done after the greeting fired.
      // We check debugLoggedResponseCreateGreeting (set when greeting response.create fires)
      // and NOT debugLoggedResponseCreateUserTurn (only set when a user-turn response.create fires).
      // This works regardless of phase, since greetingAdvancePending may already be cleared.
      const greetingFired = !!state.debugLoggedResponseCreateGreeting;
      const userTurnFired = !!state.debugLoggedResponseCreateUserTurn;
      const inGreetingPhase = greetingFired && !userTurnFired;
      if (inGreetingPhase && !(state as any).greetingAudioDone) {
        (state as any).greetingAudioDone = true;
        finalizeGreetingAdvance(state, `OpenAI ${t}`);
        state.awaitingUserAnswer = true;
        state.awaitingAnswerForStepIndex = 0;
        console.log("[AI-VOICE] greetingAudioDone = true | awaitingUserAnswer armed | commits now unblocked", {
          callSid: state.callSid,
          phase: state.phase,
          greetingFired,
          userTurnFired,
        });
      }
    }

    setWaitingForResponse(state, false, `OpenAI ${t}`);
    setResponseInFlight(state, false, `OpenAI ${t}`);
    state.outboundOpenAiDone = true;

    const buffered = state.outboundMuLawBuffer?.length || 0;

    // ✅ Do NOT drop partial tail audio (<1 frame). Pad with μ-law silence to a full 20ms frame.
    // This prevents end-of-speech clipping/click/static and keeps timing consistent.
    if (buffered > 0 && buffered < TWILIO_FRAME_BYTES) {
      const pad = Buffer.alloc(TWILIO_FRAME_BYTES - buffered, 0xFF);
      state.outboundMuLawBuffer = Buffer.concat([state.outboundMuLawBuffer || Buffer.alloc(0), pad]);
      ensureOutboundPacer(twilioWs, state);
      return; // let pacer send final frame; stop will happen on next drain tick
    }

    if (buffered < TWILIO_FRAME_BYTES) {
      state.outboundMuLawBuffer = Buffer.alloc(0);
      stopOutboundPacer(twilioWs, state, "OpenAI done + <1 frame buffered");
      setAiSpeaking(state, false, `OpenAI ${t} (buffer < 1 frame)`);
      (state as any).lastListenEnabledAtMs = Date.now();
      (state as any).listenWarmupUntilMs = Date.now() + 2000;

      // ✅ Force greetingAudioDone on <1 frame path too
      if (state.phase === "awaiting_greeting_reply" && !(state as any).greetingAudioDone) {
        (state as any).greetingAudioDone = true;
        finalizeGreetingAdvance(state, `OpenAI ${t} (<1frame path)`);
        state.awaitingUserAnswer = true;
        state.awaitingAnswerForStepIndex = 0;
        console.log("[AI-VOICE] greetingAudioDone=true on <1frame path | awaitingUserAnswer armed", { callSid: state.callSid });
      }

      maybePerformPendingLiveTransfer(twilioWs, state, `OpenAI ${t} (buffer < 1 frame)`);
      void replayPendingCommittedTurn(twilioWs, state, `OpenAI ${t} (buffer < 1 frame)`);
    }
  }

  try {
    const control =
      event?.control ||
      event?.metadata?.control ||
      event?.item?.metadata?.control;

    if (control && typeof control === "object") {
      if (control.kind === "book_appointment" && !state.finalOutcomeSent) {
        // ✅ Patch 3+: allow booking only when we have an exact time (or a confirm "yes" after a recent exact time)
        const lastAccepted = String(state.lastAcceptedUserText || "").trim();
        const lastExactTime = String((state as any).lastExactTimeText || "").trim();
        const lastExactAt = Number((state as any).lastExactTimeAtMs || 0);

        const hasRecentExactTime =
          !!lastExactTime &&
          isExactClockTimeMentioned(lastExactTime) &&
          lastExactAt > 0 &&
          (Date.now() - lastExactAt) < 5 * 60 * 1000; // 5 minutes

        const allowBooking =
          (!!lastAccepted && isExactClockTimeMentioned(lastAccepted)) ||
          (!!lastAccepted && isAffirmativeConfirmation(lastAccepted) && hasRecentExactTime);

        if (!allowBooking) {
          console.log("[AI-VOICE][BOOKING][IGNORE] book_appointment without explicit time/confirm gate", {
            callSid: state.callSid,
            lastAcceptedUserText: (lastAccepted || "").slice(0, 140),
            lastExactTimeText: (lastExactTime || "").slice(0, 140),
            hasRecentExactTime: !!hasRecentExactTime,
          });
        } else {
          await handleBookAppointmentIntent(state, control);
        }
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
    leadTimeZone: leadTimeZoneRaw,
    agentTimeZone: agentTimeZoneRaw,
    notes,
  } = control;

  if (!startTimeUtc || !durationMinutes) {
    console.warn("[AI-VOICE] Incomplete book_appointment control payload:", {
      callSid: state.callSid,
      leadId: ctx.leadId,
      hasStartTimeUtc: !!startTimeUtc,
      hasDurationMinutes: !!durationMinutes,
    });
    return;
  }

  const startDate = parseStartTimeUtcToDate(startTimeUtc);
  if (!startDate) {
    console.warn(
      "[AI-VOICE][BOOKING][SKIP] Invalid startTimeUtc (will NOT call booking):",
      {
        callSid: state.callSid,
        leadId: ctx.leadId,
        startTimeUtcRaw: startTimeUtc,
      }
    );
    return;
  }

  /**
   * ✅ ONLY NEEDED UPDATE:
   * - lead tz: prefer ctx.raw.lead tz when present; otherwise use model-provided leadTimeZone; otherwise fallback chain
   * - agent tz: ALWAYS prefer ctx.agentTimeZone (source of truth) over model-provided agentTimeZone
   *
   * This guarantees:
   * - "lead time zone" stays the lead's zone (when CoveCRM provided it)
   * - the calendar booking always uses the agent's zone consistently
   */
  const leadTzHint = getLeadTimeZoneHintFromContext(ctx);
  const tz = normalizeTimeZones(
    leadTimeZoneRaw || leadTzHint,
    ctx.agentTimeZone || agentTimeZoneRaw,
    ctx
  );
  const leadTimeZone = tz.leadTz;
  const agentTimeZone = tz.agentTz;

  try {
    console.log("[AI-VOICE][BOOKING][VALIDATE]", {
      callSid: state.callSid,
      leadId: ctx.leadId,
      startTimeUtcRaw: startTimeUtc,
      startTimeUtcIso: startDate.toISOString(),
      leadTimeZone,
      agentTimeZone,
      leadLocal: formatInTimeZone(startDate, leadTimeZone),
      agentLocal: formatInTimeZone(startDate, agentTimeZone),
      durationMinutes,
      leadTzWasFallback: tz.leadTzWasFallback,
      agentTzWasFallback: tz.agentTzWasFallback,
      leadTzHintUsed: !!leadTzHint && leadTimeZone === leadTzHint,
      agentTzForcedFromCtx:
        agentTimeZone === String(ctx.agentTimeZone || "").trim(),
    });
  } catch {}

  try {
    const url = new URL(BOOK_APPOINTMENT_URL);
    url.searchParams.set("key", AI_DIALER_CRON_KEY);

    const safeNotes =
      typeof notes === "string" && notes.trim()
        ? `${notes}\n[callSid: ${state.callSid}]`
        : notes;

    const body = {
      aiCallSessionId: ctx.sessionId,
      leadId: ctx.leadId,
      startTimeUtc: startDate.toISOString(),
      durationMinutes,
      leadTimeZone,
      agentTimeZone,
      notes: safeNotes,
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

    const json: any = await resp.json().catch(() => ({}));

    console.log("[AI-VOICE][BOOKING][RESPONSE]", {
      callSid: state.callSid,
      leadId: ctx.leadId,
      status: resp.status,
      ok: !!json?.ok,
    });

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

    if (json.ok && ctx.clientPhone && COVECRM_API_SECRET) {
      try {
        const smsUrl = new URL("/api/ai-calls/booking-confirmation-sms", COVECRM_BASE_URL);
        smsUrl.searchParams.set("key", AI_DIALER_CRON_KEY);
        await fetch(smsUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ai-dialer-key": AI_DIALER_CRON_KEY,
          },
          body: JSON.stringify({
            leadId: ctx.leadId,
            leadPhone: ctx.clientPhone,
            agentName: ctx.agentName,
            appointmentTime: body.startTimeUtc,
            leadTimeZone: leadTimeZone,
            agentTimeZone: agentTimeZone,
            userEmail: ctx.userEmail,
          }),
        });
        console.log("[AI-VOICE][SMS-CONFIRM] Confirmation SMS triggered for lead:", ctx.leadId);
      } catch (err: any) {
        console.warn("[AI-VOICE][SMS-CONFIRM] Non-blocking SMS trigger failed:", err?.message);
      }
    }
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
      dispositionRule: outcomeRaw === "booked" ? "move_to_booked" :
        outcomeRaw === "not_interested" ? "move_to_not_interested" :
        outcomeRaw === "do_not_call" ? "move_to_do_not_call" :
        "leave_in_place",
    };

    const resp = await fetch(OUTCOME_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-key": AI_DIALER_AGENT_KEY,
      },
      body: JSON.stringify(body),
    });

    const json: any = await resp.json().catch(() => ({}));

    console.log("[AI-VOICE][OUTCOME][RESPONSE]", {
      callSid: state.callSid,
      leadId: state.context?.leadId,
      status: resp.status,
      ok: !!json?.ok,
      outcome: outcomeRaw,
    });

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

    const json: any = await resp.json().catch(() => ({}));

    console.log("[AI-VOICE][USAGE][RESPONSE]", {
      callSid: state.callSid,
      sessionId: state.context.sessionId,
      status: resp.status,
      ok: !!json?.ok,
      minutes,
      vendorCostUsd,
    });

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
