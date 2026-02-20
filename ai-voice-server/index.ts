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
  process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";

console.log("[AI-VOICE] Realtime model resolved:", OPENAI_REALTIME_MODEL, "(env:", process.env.OPENAI_REALTIME_MODEL ? "set" : "default", ")");

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

  // ✅ Delay advancing out of greeting until we confirm OpenAI actually produced audio (prevents Step 0 skip)
  greetingAdvancePending?: boolean;
  greetingAdvanceNextIndex?: number;
  greetingAdvanceNextPhase?: CallPhase;

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

  // ✅ Human-like waiting + reprompt (NEW)
  lastPromptSentAtMs?: number;
  lastPromptLine?: string;
  repromptCountForCurrentStep?: number;
  lowSignalCommitCount?: number;

  // ✅ time indecision handling (availability / 'you pick')
  timeOfferCountForStepIndex?: number;
  timeOfferCount?: number;

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
  // cost control: throttle silence frames we forward to OpenAI (keep VAD working)
  lastSilenceSentAtMs?: number;


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
 * ✅ Script-aware scope label (prevents cross-script wording drift)
 * We keep the hard lock, but we match the selected scriptKey.
 */
function getScopeLabelForScriptKey(scriptKeyRaw: any): string {
  const k = normalizeScriptKey(scriptKeyRaw);
  if (k === "mortgage_protection") return "mortgage protection";
  if (k === "final_expense") return "final expense coverage";
  if (k === "iul_cash_value") return "cash value life insurance (IUL)";
  if (k === "veteran_leads") return "veteran life insurance programs";
  if (k === "trucker_leads") return "life insurance for truckers";
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
          void replayPendingCommittedTurn(twilioWs, live, "pacer drained");
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
        void replayPendingCommittedTurn(twilioWs, live, "pacer drained");
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



async function replayPendingCommittedTurn(
  twilioWs: WebSocket,
  state: CallState,
  reason: string
) {
  try {
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
      restoredAudioMs,
    });

    // ✅ Re-run the same commit logic path by directly invoking the same response.create decision logic
    // We do NOT touch audio streaming; we only create a response now that drain is complete.

    const lastUserText = String(state.lastUserTranscript || "").trim();
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

    const isGreetingReply = state.phase === "awaiting_greeting_reply";

    if (isGreetingReply) {
      const lineToSay = steps[0] || getBookingFallbackLine(state.context!);

      // ✅ Guard: do NOT treat empty/noisy commits as a greeting reply.
      // Require real words OR strong audio (fallback) before advancing past greeting.
      const greetAudioMs = Number(state.userAudioMsBuffered || 0);
      if (!lastUserText && greetAudioMs < 1400) return;
      const ack = getGreetingAckPrefix(lastUserText);

      if (isGreetingNegativeHearing(lastUserText)) {
        const aiName2 = (state.context!.voiceProfile.aiName || "Alex").trim() || "Alex";
        const clientName2 = (state.context!.clientFirstName || "").trim() || "there";
        const retryLine = `Okay — can you hear me now, ${clientName2}? This is ${aiName2}.`;
        const retryInstr = buildStepperTurnInstruction(state.context!, retryLine);

        state.awaitingUserAnswer = false;
        state.awaitingAnswerForStepIndex = undefined;
        state.userAudioMsBuffered = 0;
        state.lastUserTranscript = "";
        state.lowSignalCommitCount = 0;
        state.repromptCountForCurrentStep = 0;

        await humanPause();

        setWaitingForResponse(state, true, "response.create (greeting retry)");
        setAiSpeaking(state, true, "response.create (greeting retry)");
        setResponseInFlight(state, true, "response.create (greeting retry)");
        state.outboundOpenAiDone = false;

        state.lastPromptSentAtMs = Date.now();
        state.lastPromptLine = retryLine;
        state.lastResponseCreateAtMs = Date.now();

        state.openAiWs.send(
          JSON.stringify({
            type: "response.create",
            response: { modalities: ["audio", "text"], temperature: 0.6, instructions: retryInstr },
          })
        );

        state.phase = "awaiting_greeting_reply";
        return;
      }

      const lineToSay2 = `${ack} ${lineToSay}`;
      const perTurnInstr = buildStepperTurnInstruction(state.context!, lineToSay2);

      state.awaitingUserAnswer = false;
      state.awaitingAnswerForStepIndex = undefined;
      state.userAudioMsBuffered = 0;
      state.lastUserTranscript = "";
      state.lowSignalCommitCount = 0;
      state.repromptCountForCurrentStep = 0;

      await humanPause();

      setWaitingForResponse(state, true, "response.create (stepper after greeting)");
      setAiSpeaking(state, true, "response.create (stepper after greeting)");
      setResponseInFlight(state, true, "response.create (stepper after greeting)");
      state.outboundOpenAiDone = false;

      state.lastPromptSentAtMs = Date.now();
      state.lastPromptLine = lineToSay2;
      state.lastResponseCreateAtMs = Date.now();

      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: { modalities: ["audio", "text"], temperature: 0.6, instructions: perTurnInstr },
        })
      );

      // ✅ Do NOT advance out of greeting yet.
      // We only advance after we confirm OpenAI actually produced outbound audio (first audio.delta).
      let nextIdx = steps.length > 1 ? 1 : 0;

      // ✅ Keep stepper alignment: rebuttals end with a booking question.
      // If the objection happens early (Step 1), we just asked the Step 2 booking question in the rebuttal.
      // Move scriptStepIndex forward so the NEXT user reply is interpreted as answering Step 2 (not Step 1).
      try {
        const lt = String(lineToSay || "").toLowerCase();
        const askedBookingQ =
          lt.includes("later today") || lt.includes("today or tomorrow") || lt.includes("tomorrow be better");
        if (askedBookingQ) {
          // idx is the NEXT step-to-say; expectedAnswerIdx = idx - 1.
          // We want expectedAnswerIdx to be Step 2 after this rebuttal, so idx must be 2.
          if (idx <= 1) {
            nextIdx = Math.min(2, Math.max(0, (steps.length || 0) - 1));
          }
        }
      } catch {}

      state.greetingAdvancePending = true;
      state.greetingAdvanceNextIndex = nextIdx;
      state.greetingAdvanceNextPhase = "in_call";

      // Stay in greeting phase until we see outbound audio actually start.
      state.phase = "awaiting_greeting_reply";
      return;
    }

    if (objectionOrQuestionKind) {
      const lineToSay = enforceBookingOnlyLine(state.context!, getRebuttalLine(state.context!, objectionOrQuestionKind));
      const perTurnInstr = buildConversationalRebuttalInstruction(state.context!, lineToSay, {
        objectionKind: objectionOrQuestionKind,
        userText: lastUserText,
        lastOutboundLine: state.lastPromptLine,
        lastOutboundAtMs: state.lastPromptSentAtMs,
      });

      state.awaitingUserAnswer = false;
      state.awaitingAnswerForStepIndex = undefined;
      state.userAudioMsBuffered = 0;
      state.lastUserTranscript = "";
      state.lowSignalCommitCount = 0;
      state.repromptCountForCurrentStep = 0;

      await humanPause();

      setWaitingForResponse(state, true, "response.create (objection)");
      setAiSpeaking(state, true, "response.create (objection)");
      setResponseInFlight(state, true, "response.create (objection)");
      state.outboundOpenAiDone = false;

      state.lastPromptSentAtMs = Date.now();
      state.lastPromptLine = lineToSay;
      state.lastResponseCreateAtMs = Date.now();

      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: { modalities: ["audio", "text"], temperature: 0.6, instructions: perTurnInstr },
        })
      );

      // ✅ Keep stepper alignment: rebuttals end with a booking question.
      // If the rebuttal asked the Step 2 booking question (today vs tomorrow),
      // move scriptStepIndex forward so the NEXT user reply is interpreted as answering Step 2.
      try {
        const lt = String(lineToSay || "").toLowerCase();
        const askedBookingQ =
          lt.includes("later today") || lt.includes("today or tomorrow") || lt.includes("tomorrow be better");
        if (askedBookingQ) {
          if (idx <= 1) {
            state.scriptStepIndex = Math.min(2, Math.max(0, (steps.length || 0) - 1));
          }
        }
      } catch {}


      // ✅ After an objection rebuttal, re-arm the stepper so the next user reply
      // is treated as answering the last asked step (keeps script flow natural).
      state.awaitingUserAnswer = true;
      state.awaitingAnswerForStepIndex = expectedAnswerIdx;

      state.phase = "in_call";
      return;
    }

    // Default: continue script step flow — MUST mirror normal commit path (guards + time logic + reprompt).
    const audioMs = Number(state.userAudioMsBuffered || 0);
    const hasTranscript = lastUserText.length > 0;

    // don't speak unless transcript OR very strong audio
    const canSpeak = hasTranscript || audioMs >= 1400;

    const stepLine = String(steps[idx] || "");
    const exactTimeRequired =
      stepType === "time_question" && isExactTimeQuestion(stepLine);

    const canAdvance =
      hasTranscript &&
      (stepType !== "time_question"
        ? !isFillerOnly(lastUserText)
        : isExactClockTimeMentioned(lastUserText));

    const treatAsAnswer = shouldTreatCommitAsRealAnswer(
      stepType,
      audioMs,
      lastUserText
    );

    // Window-only reply ("afternoon") is NOT valid for broad day/time question unless it includes day reference or exact time.
    const forceNotAnswer =
      stepType === "time_question" &&
      !exactTimeRequired &&
      hasTranscript &&
      isTimeWindowMentioned(lastUserText) &&
      !isDayReferenceMentioned(lastUserText) &&
      !isExactOrOfferedClockTime(String(state.lastPromptLine || ""), lastUserText);

    if (!canSpeak) {
      state.lowSignalCommitCount = (state.lowSignalCommitCount || 0) + 1;
      return;
    }

    if (!treatAsAnswer || forceNotAnswer) {

      // ✅ Guard: if we only got a hesitation fragment, DO NOT reprompt (reprompts cause cut-offs).
      // Examples: "um", "uh", "uhh", "umm", "probably", "maybe"
      // Treat this like low-signal and WAIT for the next commit.
      const hes = String(lastUserText || "").trim().toLowerCase();
      const isHesitationFragment =
        isFillerOnly(hes) ||
        hes === "probably" ||
        hes === "maybe" ||
        hes === "i think" ||
        hes === "not sure";
      if (hasTranscript && isHesitationFragment) {
        state.lowSignalCommitCount = (state.lowSignalCommitCount || 0) + 1;
        return;
      }

      // ✅ Guard: do NOT reprompt on filler-only commits (prevents "um" cutoff)
      try {
        if (hasTranscript && isFillerOnly(lastUserText) && Number(audioMs || 0) < 1700) {
          state.lowSignalCommitCount = (state.lowSignalCommitCount || 0) + 1;
          return;
        }
      } catch {}

      const repromptN = Number(state.repromptCountForCurrentStep || 0);
      state.repromptCountForCurrentStep = repromptN + 1;

      // ✅ Keep booking ladder stable on replay too.
      // If the user is clearly talking about times/availability, do NOT reset to "today or tomorrow".
      let repromptLineRaw = getRepromptLineForStepType(state.context!, stepType, repromptN);
      try {
        const wantsTime =
          stepType === "time_question" ||
          (hasTranscript && (
            isTimeIndecisionOrAvailability(lastUserText) ||
            isTimeMentioned(lastUserText)
          ));
        if (wantsTime) {
            const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(idx);
            const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
            repromptLineRaw = getTimeOfferLine(
              state.context!,
              n,
              pickDayHint(lastUserText, String(state.lastAcceptedUserText || "")),
              pickTimeWindowHint(lastUserText, String(state.lastAcceptedUserText || "")),
              lastUserText
            );
            state.timeOfferCountForStepIndex = idx;
            state.timeOfferCount = n + 1;
          }
      } catch {}

      const repromptLine = applyDiscoveryCap(state, repromptLineRaw);

      try {
        console.log("[AI-VOICE][TURN-GATE][REPLAY] not-real-answer -> reprompt", {
          callSid: state.callSid,
          streamSid: state.streamSid,
          stepType,
          audioMs: Number(audioMs || 0),
          hasText: !!String(lastUserText || "").trim(),
          n: repromptN,
        });
      } catch {}

      await humanPause();

      const instr = buildStepperTurnInstruction(state.context!, repromptLine);

      setWaitingForResponse(state, true, "response.create (replay reprompt)");
      setAiSpeaking(state, true, "response.create (replay reprompt)");
      setResponseInFlight(state, true, "response.create (replay reprompt)");
      state.outboundOpenAiDone = false;

      state.lastPromptSentAtMs = Date.now();
      state.lastPromptLine = repromptLine;
      state.lastResponseCreateAtMs = Date.now();

      state.openAiWs.send(JSON.stringify({
        type: "response.create",
        response: { modalities: ["audio", "text"], instructions: instr },
      }));

      state.phase = "in_call";
      return;
    }

    let lineToSay = enforceBookingOnlyLine(state.context!, steps[idx] || getBookingFallbackLine(state.context!));

    // ✅ Day-choice answer handling:
    // If the current step is "today or tomorrow" and they answer with a day ("tomorrow")
    // but not an exact clock time yet, offer concrete options and HOLD position.
    if (stepType === "time_question" && hasTranscript) {
      const stepLineDay = String(steps[idx] || "");
      if (isDayChoiceQuestion(stepLineDay) && isDayReferenceMentioned(lastUserText) && !isExactOrOfferedClockTime(String(state.lastPromptLine || ""), lastUserText)) {
        const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(idx);
        const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
        lineToSay = getTimeOfferLine(
          state.context!,
          n,
          pickDayHint(lastUserText, String(state.lastAcceptedUserText || "")),
          pickTimeWindowHint(lastUserText, String(state.lastAcceptedUserText || "")),
          lastUserText
        );
        state.timeOfferCountForStepIndex = idx;
        state.timeOfferCount = n + 1;
      }
    }


    // ✅ hard cap discovery questions (max 2) before sending
    lineToSay = applyDiscoveryCap(state, lineToSay);

    // ✅ hard cap discovery questions (max 2) before sending
    lineToSay = applyDiscoveryCap(state, lineToSay);

        // Exact-time enforcement (mirror normal path)
    let forcedExactTimeOffer = false;
    if (stepType === "time_question") {
      const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(idx);
      const prevCount = sameStep ? Number(state.timeOfferCount || 0) : 0;

      const priorAccepted = String(state.lastAcceptedUserText || "");
      const hasPriorDay = priorAccepted ? isDayReferenceMentioned(priorAccepted) : false;

      const hasDayNow = hasTranscript && isDayReferenceMentioned(lastUserText);
      const hasWindowNow = hasTranscript && isTimeWindowMentioned(lastUserText);

      // ✅ Do not advance the script on "tomorrow"/"afternoon"/"whenever".
      // Instead: day -> ask morning/afternoon; window -> offer exact times; indecision -> offer times.
      if (hasTranscript && !isExactClockTimeMentioned(lastUserText)) {
        let n = prevCount;

        // If they only gave a day ("tomorrow"), start at the window-choice rung.
        if (hasDayNow && !hasWindowNow) {
          n = 0;
        }

        // If they gave a window ("afternoon") (with or without day), jump to exact-time offers.
        // Also allow window-only if they previously already picked a day.
        if (hasWindowNow || (hasPriorDay && isTimeWindowMentioned(lastUserText))) {
          n = Math.max(n, 1);
        }

        // If they’re vague ("either / whenever"), keep offering concrete options.
        if (isTimeIndecisionOrAvailability(lastUserText)) {
          n = Math.max(n, 1);
        }

        lineToSay = getTimeOfferLine(
            state.context!,
            n,
            pickDayHint(lastUserText, String(state.lastAcceptedUserText || "")),
            pickTimeWindowHint(lastUserText, String(state.lastAcceptedUserText || "")),
            lastUserText
          );
        state.timeOfferCountForStepIndex = idx;
        state.timeOfferCount = n + 1;
        forcedExactTimeOffer = true;
      }
    }

    // ack prefix based on last accepted step (mirror normal path)
    const prevIdx = expectedAnswerIdx;
    if (prevIdx >= 0 && state.lastAcceptedUserText && state.lastAcceptedStepIndex === prevIdx) {
      const prevLine = steps[prevIdx] || "";
      const prevType = classifyStepType(prevLine);
      const ack2 = getHumanAckPrefixForStepAnswer(prevType, state.lastAcceptedUserText);
      if (ack2) lineToSay = `${ack2} ${lineToSay}`;
    }

    // anti-loop (mirror normal path)
    try {
      const prev = String(state.lastPromptLine || "").replace(/\s+/g, " ").trim().toLowerCase();
      const next = String(lineToSay || "").replace(/\s+/g, " ").trim().toLowerCase();
      const lastAt = Number(state.lastPromptSentAtMs || 0);
      if (prev && next && prev === next && (Date.now() - lastAt) < 10000) {
        lineToSay = getBookingFallbackLine(state.context!);
      }
    } catch {}

    const perTurnInstr = buildStepperTurnInstruction(state.context!, lineToSay);
    try { console.log("[AI-VOICE][STEPPER][REPLAY-SEND]", { callSid: state.callSid, stepIndex: idx, expectedAnswerIdx, stepType, lineToSay }); } catch {}

    if (lastUserText) {
      state.lastAcceptedUserText = lastUserText;
      state.lastAcceptedStepType = stepType;
      state.lastAcceptedStepIndex = expectedAnswerIdx;

      if (isExactClockTimeMentioned(lastUserText)) {
        (state as any).lastExactTimeText = lastUserText;
        (state as any).lastExactTimeAtMs = Date.now();
      }
    }

    state.awaitingUserAnswer = false;
    state.awaitingAnswerForStepIndex = undefined;

    state.userAudioMsBuffered = 0;
    state.lastUserTranscript = "";
    state.lowSignalCommitCount = 0;
    state.repromptCountForCurrentStep = 0;

    await humanPause();

    setWaitingForResponse(state, true, "response.create (replay script step)");
    setAiSpeaking(state, true, "response.create (replay script step)");
    setResponseInFlight(state, true, "response.create (replay script step)");
    state.outboundOpenAiDone = false;

    state.lastPromptSentAtMs = Date.now();
    state.lastPromptLine = lineToSay;
    state.lastResponseCreateAtMs = Date.now();

    state.openAiWs.send(JSON.stringify({
      type: "response.create",
      response: { modalities: ["audio", "text"], instructions: perTurnInstr },
    }));

    // advance logic (mirror normal path)
    if (canAdvance) {
      state.scriptStepIndex = Math.min(idx + 1, Math.max(0, steps.length - 1));
      state.timeOfferCountForStepIndex = undefined;
      state.timeOfferCount = 0;
    } else {
      state.scriptStepIndex = idx;
    }

    state.phase = "in_call";
    return;
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
  if (!t) return "Awesome.";

  // If they sound upset / stressed
  if (
    t.includes("bad day") ||
    t.includes("not good") ||
    t.includes("terrible") ||
    t.includes("stressed") ||
    t.includes("pissed") ||
    t.includes("angry") ||
    t.includes("frustrated") ||
    t.includes("annoyed")
  ) return "I hear you.";

  // If they say they're busy
  if (t.includes("busy") || t.includes("at work") || t.includes("can't talk") || t.includes("in a meeting"))
    return "Got you.";

  // If they clearly confirm they can hear
  if (
    t == "yes" ||
    t == "yeah" ||
    t == "yep" ||
    t == "yup" ||
    t.includes("i can hear") ||
    t.includes("hear you") ||
    t.includes("yes i can") ||
    t.includes("loud and clear")
  ) return "Awesome.";

  // If they clearly cannot hear
  if (
    t == "no" ||
    t.includes("can't hear") ||
    t.includes("cannot hear") ||
    t.includes("can not hear") ||
    t.includes("hard to hear") ||
    t.includes("barely hear") ||
    t.includes("what") ||
    t.includes("huh")
  ) return "Okay.";

  // Neutral default that won't sound weird
  return "Got it.";
}

function getHumanAckPrefixForStepAnswer(
  prevStepType: StepType | undefined,
  userTextRaw: string
): string {
  const t = String(userTextRaw || "").trim().toLowerCase();
  if (!t) return "";

  // Time answers -> "Perfect."
  if (prevStepType === "time_question") return "Perfect.";

  // Yes/no or open -> quick human acknowledgement
  if (prevStepType === "yesno_question" || prevStepType === "open_question") {
    // If they sound confused, don't do a cheery ack
    if (t.includes("what") || t.includes("huh") || t.includes("confused")) return "";

    // ✅ Spouse / just-me answers should bridge cleanly into the next line
    // (prevents the next scripted sentence from sounding abrupt)
    const spouseSignals = [
      "spouse",
      "wife",
      "husband",
      "me and",
      "my wife",
      "my husband",
      "for me",
      "for my",
      "just me",
      "only me",
      "both of us",
      "us both",
    ];
    for (const k of spouseSignals) {
      if (t.includes(k)) return "Perfect.";
    }

    return "Got it.";
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
  if (new Set(["what","huh","pardon","sorry","hello"]).has(t)) return true;
  if (new Set(["what?","huh?","pardon?","sorry?","hello?"]).has(t)) return true;

  // Fallback phrase patterns (no regex escapes in TS needed here)
  if (t.includes("can not hear") || t.includes("cannot hear")) return true;
  if (t.includes("difficult to hear") || t.includes("hard to hear")) return true;

  return false;
}

function getBookingFallbackLine(ctx: AICallContext): string {
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();
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

function detectQuestionKindForTurn(textRaw: string): string | null {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return null;

  // If it's clearly a scheduling/availability question, let the existing time ladder handle it.
  try {
    if (isTimeIndecisionOrAvailability(t) || isTimeMentioned(t) || looksLikeTimeAnswer(t)) return null;
  } catch {}

  if (!looksLikeUserQuestion(t)) return null;

  // "How long / what happens" variants not covered by detectObjection
  if (
    t.includes("how long") ||
    t.includes("how much time") ||
    t.includes("how long is") ||
    t.includes("how long will this be") ||
    t.includes("how long will it be") ||
    t.includes("how long does the call") ||
    t.includes("how long is the call") ||
    t.includes("how long will the call") ||
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

  if (!choosingFirst && !choosingSecond) return null;

  // Pull the first two clock-like times from the last prompt line.
  const times: string[] = [];
  const reTime = /\b(\d{1,2}:\d{2}\s?(?:am|pm)?|\d{1,2}\s?(?:am|pm))\b/gi;
  for (const m of lastPromptLineRaw.matchAll(reTime)) {
    const t = String(m[1] || "").trim();
    if (t) times.push(t);
    if (times.length >= 2) break;
  }
  if (times.length < 2) return null;

  return choosingFirst ? times[0] : times[1];
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
    "hello",
    "hey",
    "can you hear me",
    "yeah i can hear you",
    "i can hear you",
  ]);

  if (fillers.has(t)) return true;

  // Regex catch for stretched fillers: "uhhh", "ummm", "hmmmm", etc.
  if (/^(uh+|um+|mm+|mhm+|hmm+|er+|ah+|eh+)$/.test(t)) return true;

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
  dayHint: "today" | "tomorrow" | null,
  windowHint: TimeWindowHint,
  rawUserText: string
): string {
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();

  const day = dayHint === "today" ? "later today" : (dayHint === "tomorrow" ? "tomorrow" : "tomorrow");

  // If they asked relative ("in X hours"), offer relative slots (we can't trust server timezone).
  if (windowHint === "soon_hours") {
    const h = extractSoonHours(rawUserText) || 1;
    const h2 = Math.min(12, h + 1);
    const ladder = [
      `Okay — it looks like I have availability about ${h} hour${h === 1 ? "" : "s"} from now or about ${h2} hours from now. Which would work better for you?`,
      `To keep it easy, should I put you down for about ${h} hours from now, or about ${h2} hours from now?`,
      `If you’re flexible, I can grab the next open slot around ${h}–${h2} hours from now — does that work for you?`,
      `Got it — my job is just to get you scheduled with ${agent}. About ${h} hours from now or about ${h2} hours from now better?`,
      `If it helps, I can just lock in the next available time in about ${h}–${h2} hours — does that work for you?`,
    ];
    return ladder[Math.min(n, ladder.length - 1)];
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

  // Choose timezone: lead tz hint > agent tz > Phoenix
  let tz = "";
  try { tz = String(getLeadTimeZoneHintFromContext(ctx as any) || "").trim(); } catch {}
  const ctxAgentTz = String((ctx as any)?.agentTimeZone || "").trim();
  if (!tz || !isValidIanaTimeZone(tz)) {
    if (isValidIanaTimeZone(ctxAgentTz)) tz = ctxAgentTz;
    else tz = "America/Phoenix";
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

      const i =
        wantsEarlier ? 0 :
        wantsLater ? Math.max(0, (listToUse.length - 2)) :
        ((listToUse.length > 2) ? (hv % (listToUse.length - 1)) : 0);
      a = (listToUse as any)[i] || a;
      b = (listToUse as any)[i + 1] || b;
    }
  } catch {}

  const utLock = String(rawUserText || "").toLowerCase();
  const wantsLaterLock = utLock.includes("later") || utLock.includes("latest") || utLock.includes("after");
  const lock = wantsLaterLock ? b : a;
  const ladder = [
    `Okay — it looks like they have availability at ${a} or ${b}. Which would work better for you?`,
    `Which is easier for you — ${dayLabel} at ${a}, or ${dayLabel} at ${b}?`,
    `If you’re flexible, I can lock in ${dayLabel} at ${lock} — does that work?`,
    `To keep it easy, should I put you down for ${dayLabel} at ${a}, or ${dayLabel} at ${b}?`,
    `Got it — my job is just to get you scheduled with ${agent}. ${dayLabel} at ${a} or ${b} usually better?`,
  ];

  return ladder[Math.min(n, ladder.length - 1)];
}

function shouldTreatCommitAsRealAnswer(
  stepType: StepType,
  audioMs: number,
  transcript: string
): boolean {
  const text = String(transcript || "").trim();

  // If we have transcription:
  if (text) {
    // Time questions: allow 1-word answers like "afternoon", "tomorrow", etc.
    if (stepType === "time_question") {
      return looksLikeTimeAnswer(text) || isTimeIndecisionOrAvailability(text);
    }

    // Non-time questions: be strict about filler.
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
    // ✅ Patch: booking-only reprompts (no discovery)
    const ladder = [
      `Real quick — was this for just you, or a spouse as well?`,
      `Perfect — my job is just to set up a quick call with ${agent}. Would later today or tomorrow be better?`,
      `No worries — just to get you scheduled, is later today or tomorrow better?`,
    ];
    return ladder[Math.min(n, ladder.length - 1)];
  }

  return getBookingFallbackLine(ctx);
}

function detectObjection(textRaw: string): string | null {
  const t = String(textRaw || "").trim().toLowerCase();

  // "Are you an AI / robot?"
  if (
    t.includes("are you ai") ||
    t.includes("are you an ai") ||
    t.includes("are you a robot") ||
    t.includes("are you real") ||
    t.includes("is this ai") ||
    t.includes("is this a robot") ||
    (t.includes("robot") && t.includes("?")) ||
    (t.includes("ai") && t.includes("?"))
  ) return "are_you_ai";

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

  // "What does this call entail / how long?"
  if (
    t.includes("what does this entail") ||
    t.includes("what is this about") ||
    t.includes("what is it about") ||
    t.includes("how does this work") ||
    t.includes("how long does it take") ||
    t.includes("how long will it take") ||
    t.includes("what happens on the call") ||
    t.includes("what do you cover") ||
    t.includes("what do we talk about") ||
    t.includes("what are we going over")
  ) return "what_entails";
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
    t.includes("do not call")
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
    t.includes("do not have time")
  ) {
    // If they are still actively scheduling (e.g. "tomorrow evening" / "what times do you have"),
    // do NOT treat this as an objection — let the stepper offer concrete time options.
    try {
      if (isTimeIndecisionOrAvailability(t) || isTimeMentioned(t)) return null;
    } catch {}
    return "busy";
  }
  if (t.includes("text me") || t.includes("send it") || t.includes("email me")) {
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

  // "Are you AI / robot?" -> quick human answer + redirect to booking
  if (kind === "are_you_ai") {
    const aiName = (ctx.voiceProfile?.aiName || "Alex").trim() || "Alex";
    return `(laugh) haha I get that a lot. I\'m ${aiName} - just an assistant trained to set up appointments for the licensed agent. Would later today or tomorrow be better?`;
  }

  // ✅ NEW: "Who are you / I'm confused" handling (human + on-scope)
  if (kind === "confused_identity") {
    const aiName = (ctx.voiceProfile?.aiName || "Alex").trim() || "Alex";
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    return `Hey — my name is ${aiName}. I’m calling about the ${scope} request. Would later today or tomorrow be better?`;
  }

  // ✅ NEW: "What does this call entail / how long?" handling
  if (kind === "what_entails") {
    const scope = getScopeLabelForScriptKey(ctx.scriptKey);
    // Be specific + satisfying, then go right back to booking.
    // Keep it booking-only: no rates, no underwriting, no age/health questions.
    return `Totally — it’s quick, usually about 5 to 10 minutes. ${agent} just goes over what you requested for ${scope} and answers your questions. Would later today or tomorrow be better?`;
  }

  // ✅ NEW: Generic question fallback (brief answer, then back to booking)
  if (kind === "generic_question") {
    return `Good question — ${agent} can cover that on the quick call in a couple minutes. Would later today or tomorrow be better?`;
  }

  // Existing objections
  if (kind === "busy") {
    return `Totally understand. That’s why I’m just scheduling — it’ll be a short call with ${agent}. Would later today or tomorrow be better?`;
  }
  if (kind === "send_it") {
    return `I can, but it’s usually easier to schedule a quick call so you don’t have to go back and forth. Would later today or tomorrow be better?`;
  }
  if (kind === "already_have") {
    return `I hear you — a lot of people we talk to already have something in place and find out they’re overpaying. Let’s set up a quick 3–5 minute call with ${agent} to see if we can save you at least $20 a month — is that fair? Would later today or tomorrow be better?`;
  }
  if (kind === "how_much") {
    return `Good question — ${agent} covers that on the quick call because it depends on what you want it to do. Would later today or tomorrow be better?`;
  }
  if (kind === "dont_remember") {
    // Stay inside life-insurance context
    return `No worries — it was just a request for information on life insurance. Was that for just you, or a spouse as well?`;
  }
  if (kind === "scam") {
    return `I understand. This is just a scheduling call tied to your life insurance request. ${agent} will explain everything clearly on the phone. Would later today or tomorrow be better?`;
  }
  if (kind === "not_interested") {
    return `No worries at all. Would you like me to close this out, or would a quick call later today or tomorrow be better?`;
  }

  // ✅ IMPORTANT: redirect stays booking-only, never follows disallowed topics
  if (kind === "redirect") {
    return getBookingFallbackLine(ctx);
  }

  return getBookingFallbackLine(ctx);
}

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
function buildConversationalRebuttalInstruction(
  ctx: AICallContext,
  baseLineToUse: string,
  opts?: {
    objectionKind?: string;
    userText?: string;
    lastOutboundLine?: string;
    lastOutboundAtMs?: number;
  }
): string {
  const leadName = (ctx.clientFirstName || "").trim() || "there";
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim() || agentRaw;

  const baseLine = String(baseLineToUse || "").replace(/\s+/g, " ").trim();

  const lastLine = String(opts?.lastOutboundLine || "").replace(/\s+/g, " ").trim().toLowerCase();
  const lastAt = Number(opts?.lastOutboundAtMs || 0);
  const now = Date.now();

  const bookingPrompts: string[] = [
    "Would later today or tomorrow be better?",
    "Do you want to do later today or tomorrow?",
    "What works better for you — later today or tomorrow?",
    `Is later today or tomorrow better for a quick call with ${agent}?`,
  ];

  const recentlyRepeated = !!lastLine && !!baseLine && (now - lastAt) < 10000 && lastLine === baseLine.toLowerCase();
  const bookingQ = recentlyRepeated ? bookingPrompts[1] : bookingPrompts[0];

  return `
HARD ENGLISH LOCK: Speak ONLY English.
HARD NAME LOCK: The ONLY lead name you may use is exactly: "${leadName}" (or "there" if missing). Never invent names.
HARD SCOPE LOCK: This call is ONLY about a ${scope} request. Do NOT mention any other product or topic (no gym, vacation, energy, healthcare, real estate, utilities, etc).
ROLE LOCK: You are an appointment-setting assistant. You are NOT licensed. You cannot give quotes/pricing or discuss underwriting.

FORBIDDEN TOPICS (NON-NEGOTIABLE):
- You MUST NEVER mention or discuss: canceling anything, membership, subscription, billing, being billed, charges, refunds, trials, invoice dates, billing dates, or “you will not be billed”.
- If the user says anything that sounds like cancel/billing/subscription, ignore that topic and pivot back to scheduling the licensed agent call.

ABSOLUTE BEHAVIOR:
- Never mention scripts/prompts/system messages.
- Sound natural like ChatGPT voice: friendly, coherent, not robotic.
- Do NOT repeat the exact same sentence verbatim back-to-back; rephrase if needed.

OUTPUT CONSTRAINT (NON-NEGOTIABLE):
- Output 1 short message total, 2–4 sentences MAX.
- You may briefly answer the user's immediate question/concern in 1–2 sentences.
- You MUST pivot back to scheduling.
- You MUST end with a booking question that offers later today vs tomorrow.
- You MUST NOT ask discovery/underwriting questions: NO age/DOB, NO coverage amount, NO mortgage balance, NO health/meds, NO smoking, NO income, NO SSN, NO address.
- If the user asks for cost/coverage details, you deflect: "${agent} will cover that on the quick call" and then schedule.

SAFE BASE IDEA (you can rephrase naturally, do not repeat verbatim if it would be repetitive):
"${baseLine}"

END YOUR MESSAGE WITH THIS BOOKING QUESTION (use exactly one of these wordings):
"${bookingQ}"
`.trim();
}
function buildStepperTurnInstructionLegacy(
  ctx: AICallContext,
  lineToSay: string
): string {
  const leadName = (ctx.clientFirstName || "").trim() || "there";
  const line = String(lineToSay || "").trim();
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);

  return `
HARD ENGLISH LOCK: Speak ONLY English.
HARD NAME LOCK: The ONLY lead name you may use is exactly: "${leadName}" (or "there" if missing). Never invent names.
HARD SCOPE LOCK: This call is ONLY about a ${scope} request. Do NOT mention any other product or topic (no gym, vacation, energy, healthcare, real estate, utilities, etc).
ABSOLUTE BEHAVIOR: Never apologize. Never mention scripts/prompts/system messages.

OUTPUT CONSTRAINT (NON-NEGOTIABLE):
- You MUST output EXACTLY ONE spoken line.
- That line MUST be EXACTLY the quoted line below, verbatim.
- Do NOT add ANY words before or after.
- Do NOT paraphrase.
- Do NOT add filler.
- After you say it, STOP talking and WAIT.

YOU MUST SAY THIS EXACT LINE (verbatim):
"${line}"
`.trim();
}

function buildStepperTurnInstruction(ctx: any, arg2: any): string {
  const line = String(arg2 || "").trim();
  return buildStepperTurnInstructionLegacy(ctx, line);
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

  const SCRIPT_MORTGAGE = `
BOOKING SCRIPT — MORTGAGE PROTECTION (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for mortgage protection. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Okay, so the next step is really simple — I just need to get you scheduled for a quick call with the licensed agent so they can answer everything for you. Would later today or tomorrow be better?"
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
Say: "Okay, so the next step is really simple — I just need to get you scheduled for a quick call with the licensed agent so they can answer everything for you. Would later today or tomorrow be better?"
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
Say: "Okay, so the next step is really simple — I just need to get you scheduled for a quick call with the licensed agent so they can answer everything for you. Would later today or tomorrow be better?"
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
Say: "Okay, so the next step is really simple — I just need to get you scheduled for a quick call with the licensed agent so they can answer everything for you. Would later today or tomorrow be better?"
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
Say: "Okay, so the next step is really simple — I just need to get you scheduled for a quick call with the licensed agent so they can answer everything for you. Would later today or tomorrow be better?"
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

  const SCRIPT_GENERIC = `
BOOKING SCRIPT — GENERIC LIFE (FOLLOW IN ORDER)

STEP 1
Say: "I was just giving you a quick call about the request you put in for life insurance. Was this for yourself, or a spouse as well?"
STOP. WAIT.

STEP 2 (BOOKING FRAME)
Say: "Okay, so the next step is really simple — I just need to get you scheduled for a quick call with the licensed agent so they can answer everything for you. Would later today or tomorrow be better?"
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
  if (scriptKey === "generic_life") return SCRIPT_GENERIC;

  return SCRIPT_MORTGAGE;
}

/**
 * ✅ Rebuttals / objection handling — booking-only.
 */
function getRebuttalsBlock(ctx: AICallContext): string {
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();

  return `
REBUTTALS (USE ONLY IF NEEDED — THEN GO RIGHT BACK TO BOOKING)

RULES
- One rebuttal at a time.
- Keep it short (1–2 sentences).
- Then ask again: "Would later today or tomorrow work better?"
- Never mention rates, underwriting, carriers, approvals, eligibility, age, health.
- Never introduce any other scenario (travel, resorts, healthcare, utilities, etc.).
- Never apologize. Never mention scripts/prompts. Never acknowledge mistakes.

OBJECTION: "I don’t have time / I’m at work"
REBUTTAL: "Totally understand. That’s why I’m just scheduling — it’ll be a short call with ${agent}. Would later today or tomorrow be better?"

OBJECTION: "Just send it / just text me"
REBUTTAL: "I can, but it’s usually easier to schedule a quick call so you don’t have to go back and forth. Would later today or tomorrow be better?"

OBJECTION: "I already have coverage"
REBUTTAL: "Got it — my job is just scheduling. It’ll be a short call with ${agent} to go over what you requested and answer any questions. Would later today or tomorrow be better?"

OBJECTION: "I already talked to someone / already spoke to someone"
REBUTTAL: "Got it — totally understand. Real quick, I’m just the scheduler. Do you remember if you already got that quick call with ${agent}, or was it someone else?"
STOP. WAIT.
- If they say they already spoke with ${agent}: "Perfect — you’re all set. I’ll mark this as already contacted. Have a good one."
- If they say it was someone else / not sure: "No worries. Would later today or tomorrow be better for a quick call with ${agent}?"
STOP. WAIT.
Then ask again: "Would later today or tomorrow be better?"

OBJECTION: "How much is it?"
REBUTTAL: "Good question — ${agent} covers that on the quick call because it depends on what you want it to do. Would later today or tomorrow be better?"

OBJECTION: "I’m not interested"
REBUTTAL: "No worries — just so I don’t waste your time, did you mean you don’t want any coverage at all, or you just don’t want a call right now?"
STOP. WAIT.
- If they say "no call right now": "All good. Would later today or tomorrow be better?"
- If they say "no coverage": "Got it. I’ll mark this as not interested. Stay blessed."

OBJECTION: "I don’t remember filling anything out"
REBUTTAL: "No worries — it was just a request for information on life insurance. Does that ring a bell?"
STOP. WAIT.

OBJECTION: "Is this a scam?"
REBUTTAL: "I understand. This is just a scheduling call tied to your life insurance request. ${agent} will explain everything clearly on the phone. Would later today or tomorrow be better?"

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
  const scope = getScopeLabelForScriptKey(scriptKey);

  const HARD_LOCKS = `
HARD ENGLISH LOCK (NON-NEGOTIABLE)
- Speak ONLY English.

HARD NAME LOCK (NON-NEGOTIABLE)
- The ONLY name you may use for the lead is exactly: "${client}"
- If the lead name is missing, use exactly: "there"
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
  const clientName = (ctx.clientFirstName || "").trim() || "there";
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);

  return [
    'HARD ENGLISH LOCK: Speak ONLY English.',
    `HARD SCOPE LOCK: This call is ONLY about a ${scope} request. Do NOT mention any other product.`,
    'HARD NAME LOCK: You may ONLY use the lead name exactly as provided. If missing, say "there". Never invent names.',
    "",
    "SYSTEM GREETING (NON-NEGOTIABLE):",
    `- Your first words MUST start with: "Hey ${clientName}."`,
    "- Keep it SHORT: 1 sentence greeting + 1 simple question.",
    `- Say exactly: "Hey ${clientName}. This is ${aiName}. Can you hear me alright?"`,
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
  const scope = getScopeLabelForScriptKey(scriptKey);

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
- This call is ONLY about the lead’s ${scope} request that the lead submitted.
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
- Do NOT ask or discuss ANY discovery or qualification topics, including but not limited to:
  age, date of birth, loan balance, mortgage amount, income, budget, coverage amount,
  policy type, health, medications, underwriting, rates, carriers, approvals, eligibility.
- Your ONLY goal is to follow the booking script and schedule the appointment.

MANDATORY REDIRECT RULE (NON-NEGOTIABLE)
- If the lead volunteers ANY of the above information, acknowledge briefly (e.g. "Got it"),
  then IMMEDIATELY return to booking without asking follow-up questions.

TURN DISCIPLINE (NON-NEGOTIABLE)
- After you ask ANY question, STOP and WAIT.
- Do NOT fill silence.

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
    throw new Error("BLOCK DEPLOY: OPENAI_API_KEY is missing.");
  }
  if (!model) {
    throw new Error("BLOCK DEPLOY: OPENAI_REALTIME_MODEL is missing.");
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
        // Keep this minimal — we only want to validate access + model name.
      }),
    });

    bodyText = await resp.text().catch(() => "");

    if (!resp.ok) {
      // Surface the body because OpenAI typically explains model/permission issues there.
      throw new Error(
        `BLOCK DEPLOY: realtime session canary failed for model='${model}' status=${resp.status} body=${bodyText.slice(0, 400)}`
      );
    }

    // Success: nothing else to do.
    try {
      console.log("[AI-VOICE] Startup guard OK: realtime session canary succeeded for model:", model);
    } catch {}
  } catch (err: any) {
    const msg = err?.message || String(err);
    throw new Error(`BLOCK DEPLOY: realtime session canary errored for model='${model}': ${msg}` + (bodyText ? ` body=${bodyText.slice(0, 400)}` : ""));
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
async function handleStart(ws: WebSocket, msg: TwilioStartEvent) {
  const state = calls.get(ws);
  if (!state) return;

  state.streamSid = msg.streamSid;
  state.callSid = msg.start.callSid;
  state.callStartedAtMs = Date.now();
  state.billedUsageSent = false;

  setWaitingForResponse(state, false, "start/reset");
  setAiSpeaking(state, false, "start/reset");
  setResponseInFlight(state, false, "start/reset");

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
      `[AI-VOICE] Loaded context for ${context.clientFirstName} (agent: ${context.agentName}, voice: ${context.voiceProfile.aiName}, openAiVoiceId: ${context.voiceProfile.openAiVoiceId}, scriptKey: ${context.scriptKey}, answeredBy: ${
        context.answeredBy || "(none)"
      })`
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

    // Treat as silence if energy is very low for most samples.
    // This avoids false "speech" from Twilio comfort-noise during AI playback.
    for (let i = 0; i < buf.length; i++) {
      const v = lut[buf[i]];
      const a = v < 0 ? -v : v;
      sumAbs += a;
      if (a < 600) quiet++;
    }

    const avgAbs = sumAbs / buf.length;
    const quietRatio = quiet / buf.length;

    // Tuned to be conservative: classify comfort-noise as silence, but keep real speech as non-silence.
    return avgAbs < 900 && quietRatio >= 0.85;
  } catch {
    // COST SAFETY: if silence detection fails on a frame, treat it as silence.
    // Otherwise we can end up streaming continuous "non-silence" to OpenAI and costs explode.
    return true;
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

    // ✅ COST CUT: while AI is in-control (speaking / waiting / draining), do NOT stream silence to OpenAI.
    // BUT: if the user has actually started talking, we must allow some silence through so server_vad can detect speech end.
    const userHasSpokenRecently = Number(state.userAudioMsBuffered || 0) >= 40; // ~2 frames
    if (isSilence && !userHasSpokenRecently) return;

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

    // Normal path: forward inbound audio to OpenAI
    // ✅ COST CUT: throttle silence frames so we don't burn tokens 24/7, but keep VAD working.
    // We still send *some* silence (~1 frame / 200ms) so server_vad can detect end-of-speech and commit turns.
            // ✅ LISTENING-ONLY: reduce OpenAI audio input cost.
    // We only forward inbound audio to OpenAI when we are actually listening for the user.
    // (Barge-in detection is local; we don't need to stream inbound audio while the AI is talking.)
    const isListening =
      !state.waitingForResponse &&
      !(state as any).responseInFlight &&
      !state.aiSpeaking;
    if (!isListening) {
      return;
    }

    const isSilenceToSend = isLikelySilenceMulawBase64(payload);
    if (isSilenceToSend) {
      // ✅ COST CUT: Do NOT stream continuous idle silence.
      // Only allow sparse silence for ~1.2s after user speech so server_vad can finalize.
      // If user is actively speaking, do NOT throttle silence.

      const nowMs = Date.now();
      const listenEnabledAt = Number((state as any).lastListenEnabledAtMs || 0);
      const allowInitialSilence = listenEnabledAt > 0 && (nowMs - listenEnabledAt) <= 1200;

      if (allowInitialSilence) {
        // ✅ Allow a tiny post-greeting "re-entry" window so server_vad can stabilize.
        // Bounded (<=1200ms) and only right after listening is re-enabled.
        // NOT continuous silence streaming.
      } else {

      const startedAt = Number((state as any).lastUserSpeechStartedAtMs || 0);
      const stopAt = Number((state as any).lastUserSpeechStoppedAtMs || 0);

      // "Actually speaking" means: we saw speech start very recently AND we have NOT seen a stop after it.
      // This avoids getting stuck in userSpeechInProgress=true forever due to comfort-noise / missing stop events.
      const speechIsActuallyActive =
        startedAt > 0 &&
        (nowMs - startedAt) <= 2500 &&
        (stopAt <= 0 || stopAt < startedAt);

      // Safety reset: if OpenAI never sends speech_stopped, do NOT let userSpeechInProgress stay true forever.
      try {
        if (state.userSpeechInProgress && !speechIsActuallyActive && startedAt > 0 && (nowMs - startedAt) > 2500) {
          state.userSpeechInProgress = false;
        }
      } catch {}

      if (!speechIsActuallyActive) {
        const recentlySpoke =
          (stopAt > 0 && (nowMs - stopAt) <= 1200) ||
          (startedAt > 0 && (nowMs - startedAt) <= 1200);

        if (!recentlySpoke) {
          return;
        }
        const lastMs = Number((state as any).lastSilenceSentAtMs || 0);
        if (nowMs - lastMs < 400) {
          return;
        }
        (state as any).lastSilenceSentAtMs = nowMs;
      }

      }
    }
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
        instructions: systemPrompt,
        modalities: ["audio", "text"],
        voice: state.context!.voiceProfile.openAiVoiceId || "alloy",
        temperature: 0.6,
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: {
          model: "gpt-4o-mini-transcribe",
          language: "en",
        },
        turn_detection: {
          type: "server_vad",
          create_response: false,

          // ✅ HOTFIX: Reduce end-of-turn silence so we don't get 3–5s dead air after the user talks.
          // Default can be too slow; this makes "speech_stopped/committed" fire faster.
          silence_duration_ms: 550,

          // ✅ Helps keep the start of user speech from being clipped.
          prefix_padding_ms: 300,
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

  // ============================
  // TURN-TAKING TIMING SIGNALS
  // ============================

  if (t === "input_audio_buffer.speech_started") {
    try {
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

    // ✅ STUCK-SPEECH FAILSAFE:
    // If OpenAI never emits speech_stopped, force a commit so the call doesn't go dead silent forever.
    try {
      state.userSpeechStuckWatchdog = setTimeout(() => {
        try {
          if (!state.userSpeechInProgress) return;
          if (!state.openAiWs || !state.openAiReady) return;
          if (state.voicemailSkipArmed) return;

          // Don't force-commit during outbound or in-flight responses
          if (state.aiSpeaking || state.waitingForResponse || (state as any).responseInFlight) return;

          const nowMs = Date.now();
          const startedAt = Number((state as any).lastUserSpeechStartedAtMs || 0);
          const stopAt = Number((state as any).lastUserSpeechStoppedAtMs || 0);

          if (startedAt <= 0) return;
          // Still no stop after this start
          if (stopAt > 0 && stopAt >= startedAt) return;

          // Only fire if we've been "speaking" too long (VAD stuck). Keep conservative.
          if ((nowMs - startedAt) < 3200) return;

          console.log("[AI-VOICE][VAD] stuck-speech forcing input_audio_buffer.commit", {
            callSid: state.callSid,
            streamSid: state.streamSid,
            msSinceStart: nowMs - startedAt,
          });

          // Mark as stopped locally so downstream gating can proceed
          state.userSpeechInProgress = false;
          (state as any).lastUserSpeechStoppedAtMs = Date.now();

          state.openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        } catch {}
      }, 3400);
    } catch {}

    // ✅ Prevent stale transcript from previous turn contaminating this new utterance
    state.lastUserTranscript = "";
    try {
      if (state.lastUserTranscriptPartialByItemId) state.lastUserTranscriptPartialByItemId = {};
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
          state.openAiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        } catch {}
      }, 220);
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
          const prev = state.lastUserTranscriptPartialByItemId[itemId] || "";
          const next = (prev + d).replace(/\s+/g, " ").trim();
          state.lastUserTranscriptPartialByItemId[itemId] = next;
          state.lastUserTranscript = next;

          // ✅ FIX: delta arrives before completed; if we are waiting on a committed turn,
          // replay immediately once we have *any* text.
          try {
            const pending = (state as any).pendingCommittedTurn;
            const pendingHasNoText =
              pending && !String(pending.bestTranscript || "").trim();

            const got = String(next || "").trim();
            if (
              pendingHasNoText &&
              got &&
              !state.aiSpeaking &&
              !state.waitingForResponse &&
              !state.responseInFlight &&
              state.openAiWs &&
              state.openAiReady &&
              !state.voicemailSkipArmed
            ) {
              pending.bestTranscript = got;
              void replayPendingCommittedTurn(twilioWs, state, "transcript delta");
            }
          } catch {}
        }
      } else if (typeLower === "conversation.item.input_audio_transcription.completed") {
        const tr = String((event as any)?.transcript || "").trim();
        if (itemId && tr) {
          const clean = tr.replace(/\s+/g, " ").trim();
          state.lastUserTranscriptByItemId[itemId] = clean;
          state.lastUserTranscriptPartialByItemId[itemId] = "";
          state.lastUserTranscript = clean;
          // ✅ FIX: If a user turn was committed before transcription arrived,
          // replay it as soon as we have ANY transcript text (delta or completed).
          try {
            const pending = (state as any).pendingCommittedTurn;
            const pendingHasNoText =
              pending && !String(pending.bestTranscript || "").trim();

            const got = String(clean || "").trim();
            if (
              pendingHasNoText &&
              got &&
              !state.aiSpeaking &&
              !state.waitingForResponse &&
              !state.responseInFlight &&
              state.openAiWs &&
              state.openAiReady &&
              !state.voicemailSkipArmed
            ) {
              pending.bestTranscript = got;
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
            await sleep(150);
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
          if (isHuman) await sleep(250);
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
        const clientName = (liveState.context!.clientFirstName || "").trim() || "there";
        const greetingLine = `Hey ${clientName}. This is ${aiName}. Can you hear me alright?`;
        const greetingInstr = buildStepperTurnInstruction(liveState.context!, greetingLine);

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
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["audio", "text"],

              instructions: greetingInstr,
            },
          })
        );

      })();
    }

    return;
  }

  if (t === "input_audio_buffer.committed") {
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


    // ✅ Guard: ignore committed user turns until the greeting has actually been sent.
    // Pre-greeting noise/buffer flush can produce committed events and trigger REPLAY, knocking the stepper off-script.
    if (state.phase === "awaiting_greeting_reply" && !state.debugLoggedResponseCreateGreeting) {
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
                (state as any).pendingFillerCommit = null;
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

    const lastUserText = String(state.lastUserTranscript || "").trim();
    const objectionKind = lastUserText ? detectObjection(lastUserText) : null;

    const questionKind = !objectionKind && lastUserText ? detectQuestionKindForTurn(lastUserText) : null;
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

    if (isGreetingReply) {
      const lineToSay = steps[0] || getBookingFallbackLine(state.context!);

      // ✅ Human-sounding deterministic acknowledgment after "Can you hear me?"
      // We ONLY do this on the very first step after the greeting.
      const ack = getGreetingAckPrefix(lastUserText);
      if (isGreetingNegativeHearing(lastUserText)) {
        // If they couldn't hear, re-ask hearing check instead of advancing steps.
        const aiName2 = (state.context!.voiceProfile.aiName || "Alex").trim() || "Alex";
        const clientName2 = (state.context!.clientFirstName || "").trim() || "there";
        const retryLine = `Okay — can you hear me now, ${clientName2}? This is ${aiName2}.`;
        const retryInstr = buildStepperTurnInstruction(state.context!, retryLine);

        // consume awaitingUserAnswer ONLY when we are about to speak
        state.awaitingUserAnswer = false;
        state.awaitingAnswerForStepIndex = undefined;

        state.userAudioMsBuffered = 0;
        state.lastUserTranscript = "";
        state.lowSignalCommitCount = 0;
        state.repromptCountForCurrentStep = 0;

        await humanPause();

        setWaitingForResponse(state, true, "response.create (greeting retry)");
        setAiSpeaking(state, true, "response.create (greeting retry)");
        setResponseInFlight(state, true, "response.create (greeting retry)");
        state.outboundOpenAiDone = false;

        state.lastPromptSentAtMs = Date.now();
        state.lastPromptLine = retryLine;
        state.lastResponseCreateAtMs = Date.now();

        state.openAiWs.send(
          JSON.stringify({
            type: "response.create",
            response: { modalities: ["audio", "text"], temperature: 0.6, instructions: retryInstr },
          })
        );

        // Stay in greeting phase; do NOT advance steps.
        state.phase = "awaiting_greeting_reply";
        return;
      }

      // prefix the first script step with a safe ack
      const lineToSay2 = `${ack} ${lineToSay}`;      const perTurnInstr = buildStepperTurnInstruction(
        state.context!,
        lineToSay2
      );

      // ✅ consume awaitingUserAnswer ONLY when we are about to speak
      state.awaitingUserAnswer = false;
      state.awaitingAnswerForStepIndex = undefined;

      state.userAudioMsBuffered = 0;
      state.lastUserTranscript = "";
      state.lowSignalCommitCount = 0;
      state.repromptCountForCurrentStep = 0;

      await humanPause();

      setWaitingForResponse(
        state,
        true,
        "response.create (stepper after greeting)"
      );
      setAiSpeaking(state, true, "response.create (stepper after greeting)");
      setResponseInFlight(
        state,
        true,
        "response.create (stepper after greeting)"
      );
      state.outboundOpenAiDone = false;

      try {
        if (!state.debugLoggedResponseCreateUserTurn) {
          state.debugLoggedResponseCreateUserTurn = true;
          console.log("[AI-VOICE][RESPONSE-CREATE][USER-TURN]", {
            callSid: state.callSid,
            streamSid: state.streamSid,
            scriptKey: normalizeScriptKey(state.context?.scriptKey),
            phase: state.phase,
            isGreetingReply: true,
            mode: "script_step",
            stepIndex: 0,
            stepsCount: steps.length,
            instructionLen: perTurnInstr.length,
            hasUserTranscript: !!lastUserText,
            objectionKind: objectionKind || "(none)",
          });
        }
      } catch {}

      state.lastPromptSentAtMs = Date.now();
      state.lastPromptLine = lineToSay2;
      state.lastResponseCreateAtMs = Date.now();

      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: { modalities: ["audio", "text"], temperature: 0.6, instructions: perTurnInstr },
        })
      );

      // ✅ Do NOT advance out of greeting yet.
      // We only advance after we confirm OpenAI actually produced outbound audio (first audio.delta).
      state.greetingAdvancePending = true;
      state.greetingAdvanceNextIndex = steps.length > 1 ? 1 : 0;
      state.greetingAdvanceNextPhase = "in_call";

      // Stay in greeting phase until we see outbound audio actually start.
      state.phase = "awaiting_greeting_reply";
      return;
    }

    if (objectionOrQuestionKind) {
      const lineToSay = enforceBookingOnlyLine(state.context!, getRebuttalLine(state.context!, objectionOrQuestionKind));
      const perTurnInstr = buildConversationalRebuttalInstruction(state.context!, lineToSay, {
        objectionKind: objectionOrQuestionKind,
        userText: lastUserText,
        lastOutboundLine: state.lastPromptLine,
        lastOutboundAtMs: state.lastPromptSentAtMs,
      });

      // ✅ consume awaitingUserAnswer ONLY when we are about to speak
      state.awaitingUserAnswer = false;
      state.awaitingAnswerForStepIndex = undefined;

      state.userAudioMsBuffered = 0;
      state.lastUserTranscript = "";
      state.lowSignalCommitCount = 0;

      await humanPause();

      setWaitingForResponse(state, true, "response.create (rebuttal)");
      setAiSpeaking(state, true, "response.create (rebuttal)");
      setResponseInFlight(state, true, "response.create (rebuttal)");
      state.outboundOpenAiDone = false;

      state.lastPromptSentAtMs = Date.now();
      state.lastPromptLine = lineToSay;
      state.lastResponseCreateAtMs = Date.now();

      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: { modalities: ["audio", "text"], temperature: 0.6, instructions: perTurnInstr },
        })
      );


      // ✅ After an objection rebuttal, re-arm the stepper so the next user reply
      // is treated as answering the last asked step (keeps script flow natural).
      state.awaitingUserAnswer = true;
      state.awaitingAnswerForStepIndex = expectedAnswerIdx;

      state.phase = "in_call";
      return;
    }

    const audioMs = Number(state.userAudioMsBuffered || 0);

    const hasTranscript = lastUserText.length > 0;

    // ✅ Patch 3: don't respond/advance on low-signal commits unless we have transcript OR very strong audio.
    const canSpeak = hasTranscript || audioMs >= 1400;

    // ✅ Patch 3: ONLY advance when we have transcript.
    // For time_question:
    // - Broad time questions (today vs tomorrow, daytime vs evening) can advance on "tomorrow"/"afternoon"/etc.
    // - Exact-time questions MUST have an exact clock time (e.g., 2pm) before advancing.
    const stepLine = String(steps[idx] || "");
    const exactTimeRequired =
      stepType === "time_question" && isExactTimeQuestion(stepLine);

    const canAdvance =
      hasTranscript &&
      (stepType !== "time_question"
        ? !isFillerOnly(lastUserText)
        : exactTimeRequired
          ? isExactOrOfferedClockTime(String(state.lastPromptLine || ""), lastUserText)
          : (
              // Booking Step 2 (later today vs tomorrow): HOLD and present options until an exact clock time is selected.
              isDayChoiceQuestion(stepLine)
                ? isExactOrOfferedClockTime(String(state.lastPromptLine || ""), lastUserText)
                : (isDayReferenceMentioned(lastUserText) || isExactOrOfferedClockTime(String(state.lastPromptLine || ""), lastUserText))));

    const treatAsAnswer = shouldTreatCommitAsRealAnswer(
      stepType,
      audioMs,
      lastUserText
    );

    // ✅ Guard: For broad time questions (Step 2 like "later today or tomorrow"),
    // a window-only reply ("afternoon") is NOT a valid answer unless it includes a day reference ("tomorrow afternoon")
    // or an exact clock time. Window-only should reprompt Step 2.
    const forceNotAnswer =
      stepType === "time_question" &&
      !exactTimeRequired &&
      hasTranscript &&
      isTimeWindowMentioned(lastUserText) &&
      !isDayReferenceMentioned(lastUserText) &&
      !isExactOrOfferedClockTime(String(state.lastPromptLine || ""), lastUserText);



    // ✅ Patch 3: if we can't confidently speak yet, treat it as low-signal and wait/reprompt later.
    if (!canSpeak) {
      state.lowSignalCommitCount = (state.lowSignalCommitCount || 0) + 1;
      return;
    }

    if (!treatAsAnswer || forceNotAnswer) {
      // ✅ HOTFIX: Never go silent after a committed user turn.
      // If we didn't accept it as a real answer, immediately reprompt.
      const repromptN = Number(state.repromptCountForCurrentStep || 0);
      state.repromptCountForCurrentStep = repromptN + 1;

      // ✅ Keep booking ladder stable:
      // If the user is clearly talking about availability/times (e.g. "what times do you have tomorrow evening"),
      // do NOT reset to "today or tomorrow" — offer concrete options and hold position.
      let repromptLine = getRepromptLineForStepType(state.context!, stepType, repromptN);
      try {
        if (hasTranscript) {
          const wantsTime =
            stepType === "time_question" ||
            isTimeIndecisionOrAvailability(lastUserText) ||
            isTimeMentioned(lastUserText);
          if (wantsTime) {
            const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(idx);
            const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
            repromptLine = getTimeOfferLine(
              state.context!,
              n,
              pickDayHint(lastUserText, String(state.lastAcceptedUserText || "")),
              pickTimeWindowHint(lastUserText, String(state.lastAcceptedUserText || "")),
              lastUserText
            );
            state.timeOfferCountForStepIndex = idx;
            state.timeOfferCount = n + 1;
          }
        }
      } catch {}
    
      try {
        console.log("[AI-VOICE][TURN-GATE] not-real-answer -> reprompt", {
          callSid: state.callSid,
          streamSid: state.streamSid,
          stepType,
          audioMs: Number(audioMs || 0),
          hasText: !!String(lastUserText || "").trim(),
          n: repromptN,
        });
      } catch {}
    
      (async () => {
        try {
          await humanPause();
        } catch {}
    
        // mark state as speaking/in-flight (use canonical setters)

        try {

          const instr = buildStepperTurnInstruction(state.context!, repromptLine);


          setWaitingForResponse(state, true, "response.create (reprompt)");

          setAiSpeaking(state, true, "response.create (reprompt)");

          setResponseInFlight(state, true, "response.create (reprompt)");

          state.outboundOpenAiDone = false;


          state.lastPromptSentAtMs = Date.now();

          state.lastPromptLine = repromptLine;

          state.lastResponseCreateAtMs = Date.now();


          state.openAiWs!.send(JSON.stringify({

            type: "response.create",

            response: { modalities: ["audio", "text"], instructions: instr },

          }));

        } catch (e) {

          try {
            console.log("[AI-VOICE] Error sending reprompt response.create:", String(e));
          } catch {}
        }
      })();
    
      return;
    }


    let lineToSay = enforceBookingOnlyLine(state.context!, steps[idx] || getBookingFallbackLine(state.context!));

    // ✅ Day-choice answer handling:
    // If the current step is "today or tomorrow" and they answer with a day ("tomorrow")
    // but not an exact clock time yet, offer concrete options and HOLD position.
    if (stepType === "time_question" && hasTranscript) {
      const stepLineDay = String(steps[idx] || "");
      if (isDayChoiceQuestion(stepLineDay) && isDayReferenceMentioned(lastUserText) && !isExactOrOfferedClockTime(String(state.lastPromptLine || ""), lastUserText)) {
        const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(idx);
        const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
        lineToSay = getTimeOfferLine(
          state.context!,
          n,
          pickDayHint(lastUserText, String(state.lastAcceptedUserText || "")),
          pickTimeWindowHint(lastUserText, String(state.lastAcceptedUserText || "")),
          lastUserText
        );
        state.timeOfferCountForStepIndex = idx;
        state.timeOfferCount = n + 1;
      }
    }


    // ✅ Exact-time enforcement:
    // If the current line is an exact-time question ("what time works best?") and the user answers with
    // a window ("afternoon") or day reference ("tomorrow") WITHOUT an exact clock time, we must offer
    // exact options and HOLD position (never finalize from a window).
    let forcedExactTimeOffer = false;
    if (stepType === "time_question") {
      const stepLine2 = String(steps[idx] || "");
      const exactRequired2 = isExactTimeQuestion(stepLine2);

      if (exactRequired2 && hasTranscript && !isExactOrOfferedClockTime(String(state.lastPromptLine || ""), lastUserText)) {
        if (
          isTimeWindowMentioned(lastUserText) ||
          isDayReferenceMentioned(lastUserText) ||
          looksLikeTimeAnswer(lastUserText)
        ) {
          const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(idx);
          const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
          lineToSay = getTimeOfferLine(
        state.context!,
        n,
        pickDayHint(lastUserText, String(state.lastAcceptedUserText || "")),
        pickTimeWindowHint(lastUserText, String(state.lastAcceptedUserText || "")),
        lastUserText
      );
          state.timeOfferCountForStepIndex = idx;
          state.timeOfferCount = n + 1;
          forcedExactTimeOffer = true;
        }
      }
    }

    // ✅ Broad day+window answer to a broad time question (e.g. "tomorrow afternoon"):
    // Offer concrete exact options and HOLD position (do not advance).
    if (
      !forcedExactTimeOffer &&
      stepType === "time_question" &&
      hasTranscript &&
      !isExactTimeQuestion(String(steps[idx] || "")) &&
      isDayReferenceMentioned(lastUserText) &&
      isTimeWindowMentioned(lastUserText) &&
      !isExactOrOfferedClockTime(String(state.lastPromptLine || ""), lastUserText)
    ) {
      const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(idx);
      const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
      lineToSay = getTimeOfferLine(
        state.context!,
        n,
        pickDayHint(lastUserText, String(state.lastAcceptedUserText || "")),
        pickTimeWindowHint(lastUserText, String(state.lastAcceptedUserText || "")),
        lastUserText
      );
      state.timeOfferCountForStepIndex = idx;
      state.timeOfferCount = n + 1;
      forcedExactTimeOffer = true;
    }

    // ✅ Time indecision: user asked "what do you have available" / "you pick" etc.
    // We should answer with options, but NOT advance the script step until a real time is given.
    if (!forcedExactTimeOffer && stepType === "time_question" && isTimeIndecisionOrAvailability(lastUserText)) {
      const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(idx);
      const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
      lineToSay = getTimeOfferLine(state.context!, n, pickDayHint(lastUserText, String(state.lastAcceptedUserText || "")), pickTimeWindowHint(lastUserText, String(state.lastAcceptedUserText || "")), lastUserText);
      state.timeOfferCountForStepIndex = idx;
      state.timeOfferCount = n + 1;
    }
    const prevIdx = expectedAnswerIdx;


    if (


      prevIdx >= 0 &&


      state.lastAcceptedUserText &&


      state.lastAcceptedStepIndex === prevIdx


    ) {


      const prevLine = steps[prevIdx] || "";


      const prevType = classifyStepType(prevLine);


      const ack2 = getHumanAckPrefixForStepAnswer(prevType, state.lastAcceptedUserText);


      if (ack2) lineToSay = `${ack2} ${lineToSay}`;
    }

    // ✅ Anti-loop: do not repeat the exact same outbound line back-to-back.
    // If we detect a duplicate within a short window, force a booking-only fallback question.
    try {
      const prev = String(state.lastPromptLine || "").replace(/\s+/g, " ").trim().toLowerCase();
      const next = String(lineToSay || "").replace(/\s+/g, " ").trim().toLowerCase();
      const lastAt = Number(state.lastPromptSentAtMs || 0);
      if (prev && next && prev === next && (Date.now() - lastAt) < 10000) {
        lineToSay = getBookingFallbackLine(state.context!);
      }
    } catch {}

    const perTurnInstr = buildStepperTurnInstruction(state.context!, lineToSay);
    try { console.log("[AI-VOICE][STEPPER][SEND]", { callSid: state.callSid, stepIndex: idx, expectedAnswerIdx, stepType, lineToSay }); } catch {}
    // ✅ Patch 3: remember what we accepted from the user BEFORE clearing transcript
    if (lastUserText) {
      state.lastAcceptedUserText = lastUserText;
      state.lastAcceptedStepType = stepType;
      state.lastAcceptedStepIndex = expectedAnswerIdx;

      // ✅ Track last exact clock time (for booking control that triggers on the confirm "yes")
      if (isExactClockTimeMentioned(lastUserText)) {
        (state as any).lastExactTimeText = lastUserText;
        (state as any).lastExactTimeAtMs = Date.now();
      }
    }

    // ✅ consume awaitingUserAnswer ONLY when we are about to speak
    state.awaitingUserAnswer = false;
    state.awaitingAnswerForStepIndex = undefined;

    state.userAudioMsBuffered = 0;
    state.lastUserTranscript = "";
    state.lowSignalCommitCount = 0;
    state.repromptCountForCurrentStep = 0;

    await humanPause();

    setWaitingForResponse(state, true, "response.create (script step)");
    setAiSpeaking(state, true, "response.create (script step)");
    setResponseInFlight(state, true, "response.create (script step)");
    state.outboundOpenAiDone = false;
    try { console.log("[AI-VOICE][RESPONSE-CREATE][SCRIPT]", { callSid: state.callSid, phase: state.phase, waitingForResponse: !!state.waitingForResponse, responseInFlight: !!state.responseInFlight, aiSpeaking: !!state.aiSpeaking, stepIndex: idx, stepType, lineHash: hash8(lineToSay), instructionLen: perTurnInstr.length }); } catch {}

    try {
      if (!state.debugLoggedResponseCreateUserTurn) {
        state.debugLoggedResponseCreateUserTurn = true;
        console.log("[AI-VOICE][RESPONSE-CREATE][USER-TURN]", {
          callSid: state.callSid,
          streamSid: state.streamSid,
          scriptKey: normalizeScriptKey(state.context?.scriptKey),
          phase: state.phase,
          isGreetingReply: false,
          mode: "script_step",
          stepIndex: idx,
          stepsCount: steps.length,
          instructionLen: perTurnInstr.length,
          hasUserTranscript: !!lastUserText,
          objectionKind: "(none)",
          stepType,
          audioMs,
        });
      }
    } catch {}

    state.lastPromptSentAtMs = Date.now();
    state.lastPromptLine = lineToSay;
    state.lastResponseCreateAtMs = Date.now();

    state.openAiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],

          instructions: perTurnInstr,
        },
      })
    );

    // ✅ Patch 3: only advance when we have a real transcript answer for this step
    if (canAdvance) {
      state.scriptStepIndex = Math.min(idx + 1, Math.max(0, steps.length - 1));
      // reset time offer ladder once we actually received a real time
      state.timeOfferCountForStepIndex = undefined;
      state.timeOfferCount = 0;
    } else {
      // hold position; next turn will reprompt / ask again
      state.scriptStepIndex = idx;
    }
    state.phase = "in_call";
    return;
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

      // ✅ If we were waiting to advance out of greeting, do it ONLY after we confirm audio started.
      if (state.greetingAdvancePending) {
        try {
          const ni = typeof state.greetingAdvanceNextIndex === "number" ? state.greetingAdvanceNextIndex : 0;
          const np = (state.greetingAdvanceNextPhase as any) || "in_call";
          state.scriptStepIndex = ni;
          state.phase = np;
        } catch {
          state.phase = "in_call";
        }
        state.greetingAdvancePending = false;
        state.greetingAdvanceNextIndex = undefined;
        state.greetingAdvanceNextPhase = undefined;
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

      // ✅ If we never produced audible greeting audio, do NOT advance steps/phases.
      if (state.greetingAdvancePending) {
        state.greetingAdvancePending = false;
        state.greetingAdvanceNextIndex = undefined;
        state.greetingAdvanceNextPhase = undefined;
        // Stay aligned to greeting (Step 0) so we don't skip straight to Step 1.
        state.phase = "awaiting_greeting_reply";
        state.scriptStepIndex = 0;
      }

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
