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

type CallPhase =
  | "init"
  | "awaiting_greeting_reply"
  | "in_call"
  | "ended";

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

  // ✅ NEW: strict call phase to enforce “greet → WAIT → script”
  phase?: CallPhase;

  // diagnostics
  debugLoggedMissingTrack?: boolean;

  // ✅ Outbound pacing buffer (μ-law bytes)
  outboundMuLawBuffer?: Buffer;
  outboundPacerTimer?: NodeJS.Timeout | null;
  outboundOpenAiDone?: boolean;

  // ✅ voicemail skip safety
  voicemailSkipArmed?: boolean;

  // ✅ OpenAI session.update retry safety
  openAiSessionUpdateSent?: boolean;
  openAiSessionUpdateRetried?: boolean;
};

const calls = new Map<WebSocket, CallState>();

/**
 * ✅ Canonical script normalization (defensive on the voice server too)
 */
function normalizeScriptKey(raw: any): string {
  const v = String(raw || "")
    .trim()
    .toLowerCase();

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

  // If already canonical, accept
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
 * μ-law @ 8k: 20ms = 160 bytes. base64 payload per 20ms frame is typically 216 chars.
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

        // ✅ DO NOT include "track" on outbound; Twilio doesn't need it
        twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid: live.streamSid,
            media: { payload },
          })
        );
      } else {
        // No full frame available right now.
        // If OpenAI is done and we have drained everything meaningful, stop pacer and drop any tiny remainder.
        if (live.outboundOpenAiDone) {
          // ✅ Minimal fix: drop remainder (<160) and fully stop pacer so aiSpeaking can't get stuck true
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
 * ✅ Voicemail detection helpers (AMD AnsweredBy values vary)
 * We only use this to PREVENT the AI from speaking into voicemail.
 * Actual hangup/chaining is handled server-side in call-status-webhook.
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
      // update in-memory context so later logic sees it
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
 * ✅ Build a session.update payload (centralized so we can safely retry)
 * IMPORTANT: OpenAI currently enforces session.temperature >= 0.6.
 * We use 0.6 (minimum) to keep behavior deterministic while staying valid.
 */
function buildSessionUpdatePayload(state: CallState) {
  const systemPrompt = buildSystemPrompt(state.context!);

  const scopeLockPrefix = `
HARD SCOPE LOCK (NON-NEGOTIABLE)
- This call is ONLY about LIFE INSURANCE (mortgage protection / final expense / income protection / leaving money behind / cash value IUL).
- You MUST NOT mention or ask about Medicare, health insurance, auto insurance, home insurance, annuities, ACA, or any other product category.
- If the lead asks about Medicare or anything outside life insurance: politely redirect back to life insurance and booking the licensed agent.
- If you are unsure, default to: "life insurance information you requested" and continue the script flow.
`.trim();

  const englishLockPrefix = `
HARD ENGLISH LOCK (NON-NEGOTIABLE)
- Output language MUST be English ONLY (U.S. English).
- NEVER output Spanish (or any other language) — not even a single word (e.g., "hola", "gracias", "buenos días"), no bilingual greetings, no translation.
- Even if the lead speaks Spanish or asks you to speak Spanish, you STILL respond ONLY in English.
- If the lead speaks Spanish: respond in English, politely say you only speak English, and offer to schedule the licensed agent to follow up.
- Do NOT translate the lead’s Spanish into English in your reply; just respond in English and move toward scheduling.
`.trim();

  return {
    type: "session.update",
    session: {
      instructions: `${scopeLockPrefix}\n\n${englishLockPrefix}\n\n${systemPrompt}`,
      modalities: ["audio", "text"],
      voice: state.context!.voiceProfile.openAiVoiceId || "alloy",

      // ✅ MUST be >= 0.6 or OpenAI rejects session.update and audio never starts.
      temperature: 0.6,

      // AUDIO FORMATS (UNCHANGED)
      input_audio_format: "g711_ulaw",
      output_audio_format: "pcm16",

      // Server-side VAD, but NO auto create_response.
      turn_detection: {
        type: "server_vad",
        create_response: false,
      },
    },
  };
}

function sendSessionUpdate(
  openAiWs: WebSocket,
  state: CallState,
  reason: string
) {
  try {
    if (!state.context) return;

    const sessionUpdate = buildSessionUpdatePayload(state);

    console.log("[AI-VOICE] Sending session.update:", {
      reason,
      openAiVoiceId: state.context.voiceProfile.openAiVoiceId,
      model: OPENAI_REALTIME_MODEL,
      temperature: sessionUpdate.session.temperature,
    });

    state.openAiSessionUpdateSent = true;
    openAiWs.send(JSON.stringify(sessionUpdate));
  } catch (err: any) {
    console.error(
      "[AI-VOICE] Error sending session.update:",
      err?.message || err
    );
  }
}

/**
 * ✅ Strict first-turn greeting that MUST stop and wait.
 */
function buildGreetingInstructions(ctx: AICallContext): string {
  const aiName = ctx.voiceProfile.aiName || "Alex";
  const clientName = ctx.clientFirstName || "there";

  return [
    'HARD ENGLISH LOCK: Speak ONLY English. Do NOT say any Spanish words.',
    'HARD SCOPE LOCK: This call is ONLY about LIFE INSURANCE. Do NOT mention Medicare or any other product.',
    "",
    "FIRST TURN REQUIREMENT (NON-NEGOTIABLE):",
    `- Your first words MUST start with: "Hey ${clientName}."`,
    "- Keep it SHORT: 1 sentence greeting + 1 simple question.",
    "- Example shape (do NOT add more):",
    `  "Hey ${clientName}. This is ${aiName}. Can you hear me okay?"`,
    "- After the question, STOP talking and WAIT for the lead to respond.",
    "- Do NOT begin the insurance script on this first turn.",
  ].join("\n");
}

/**
 * ✅ Script-start turn (after the lead responds to greeting).
 * This is where we enforce: "Hey (client) this is (AI) calling about the X you were..."
 * and then STOP again.
 */
function buildScriptStartInstructions(ctx: AICallContext): string {
  const aiName = ctx.voiceProfile.aiName || "Alex";
  const clientName = ctx.clientFirstName || "there";
  const agentRawName = ctx.agentName || "your agent";
  const agentFirstName = agentRawName.split(" ")[0] || agentRawName;

  const scriptKey = normalizeScriptKey(ctx.scriptKey);

  let reasonLine = "the life insurance information you requested";
  if (scriptKey === "mortgage_protection") {
    reasonLine = "the mortgage protection request you put in for your home";
  } else if (scriptKey === "final_expense") {
    reasonLine = "the final expense life insurance information you requested";
  } else if (scriptKey === "iul_cash_value") {
    reasonLine =
      "the cash value life insurance request you sent in, the IUL options";
  } else if (scriptKey === "veteran_leads") {
    reasonLine = "the veteran life insurance programs you were looking into";
  } else if (scriptKey === "trucker_leads") {
    reasonLine =
      "the life insurance information you requested as a truck driver";
  }

  return [
    'HARD ENGLISH LOCK: Speak ONLY English. Do NOT say any Spanish words.',
    'HARD SCOPE LOCK: This call is ONLY about LIFE INSURANCE. Do NOT mention Medicare or any other product.',
    "",
    "SECOND TURN REQUIREMENT (NON-NEGOTIABLE):",
    `- You MUST start with: "Hey ${clientName}, this is ${aiName}."`,
    `- Immediately follow with: "I’m calling about ${reasonLine}."`,
    `- Then ask ONE discovery question based on the script.`,
    "- Keep it to 1–3 short sentences total.",
    "- Then STOP talking and WAIT for the lead to answer.",
    "",
    "ROLE REMINDER:",
    `- You are NOT licensed. Your job is ONLY to set the appointment for ${agentFirstName}.`,
  ].join("\n");
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

    openAiSessionUpdateSent: false,
    openAiSessionUpdateRetried: false,
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
    const state = calls.get(ws);

    if (state) {
      stopOutboundPacer(ws, state, "twilio ws close");
    }

    if (state?.openAiWs) {
      try {
        state.openAiWs.close();
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

  // ✅ IMPORTANT: not ready until session.updated
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

  state.openAiSessionUpdateSent = false;
  state.openAiSessionUpdateRetried = false;

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

    // ✅ Provide callSid so CoveCRM can attach AnsweredBy (human/machine) when available
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

    // ✅ Defensive: normalize scriptKey in-memory even if DB somehow contains legacy key
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

  // ✅ Always ignore explicit outbound frames
  if (track === "outbound") {
    return;
  }

  // ✅ If we have positively identified voicemail, never forward audio / never speak.
  if (state.voicemailSkipArmed) {
    return;
  }

  // ✅ CRITICAL CUTOUT GUARD:
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

  // If OpenAI session not ready yet, buffer
  if (!state.openAiWs || !state.openAiReady) {
    state.pendingAudioFrames.push(payload);
    return;
  }

  try {
    const event = {
      type: "input_audio_buffer.append",
      audio: payload,
    };
    state.openAiWs.send(JSON.stringify(event));
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

    // ✅ Always send session.update using a valid temperature (>= 0.6)
    sendSessionUpdate(openAiWs, state, "open");
  });

  openAiWs.on("message", async (data: WebSocket.RawData) => {
    try {
      const text = data.toString();
      const event = JSON.parse(text);

      if (event?.type === "error") {
        console.error("[AI-VOICE] OpenAI ERROR event:", event);
      } else if (event?.type) {
        console.log("[AI-VOICE] OpenAI event:", event.type);
      } else {
        console.log(
          "[AI-VOICE] OpenAI event (no type):",
          text.slice(0, 200) + (text.length > 200 ? "..." : "")
        );
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

  // ✅ If OpenAI rejected session.update, retry ONCE safely.
  if (t === "error") {
    const code = String(event?.error?.code || "").trim();
    const param = String(event?.error?.param || "").trim();

    const isTempTooLow =
      code === "decimal_below_min_value" && param === "session.temperature";

    if (isTempTooLow && state.openAiWs && !state.openAiSessionUpdateRetried) {
      state.openAiSessionUpdateRetried = true;
      console.warn(
        "[AI-VOICE] Retrying session.update after temperature min error"
      );
      sendSessionUpdate(state.openAiWs, state, "retry after temp-min error");
      return;
    }
  }

  if (t === "session.updated" && !state.openAiConfigured) {
    state.openAiConfigured = true;
    state.openAiReady = true;

    state.phase = "awaiting_greeting_reply";

    try {
      console.log(
        "[AI-VOICE] session.updated applied voice:",
        event?.session?.voice
      );
    } catch {}

    if (state.pendingAudioFrames.length > 0) {
      console.log(
        "[AI-VOICE] Dropping buffered inbound frames before greeting to prevent VAD interrupt:",
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

      // ✅ Before greeting, try to get a definitive AMD AnsweredBy.
      (async () => {
        try {
          const existing = String(state.context?.answeredBy || "").trim();
          if (!existing) {
            await refreshAnsweredByFromCoveCRM(
              state,
              "pre-greeting attempt #1"
            );
            await sleep(450);
            await refreshAnsweredByFromCoveCRM(
              state,
              "pre-greeting attempt #2"
            );
          }
        } catch {}

        const answeredByNow = String(state.context?.answeredBy || "").toLowerCase();

        if (isVoicemailAnsweredBy(answeredByNow)) {
          console.log(
            "[AI-VOICE] AMD indicates voicemail/machine — suppressing all speech",
            {
              streamSid: state.streamSid,
              callSid: state.callSid,
              answeredBy: answeredByNow || "(machine)",
            }
          );

          state.voicemailSkipArmed = true;
          safelyCloseOpenAi(state, "voicemail detected pre-greeting");
          return;
        }

        const isHuman = answeredByNow === "human";
        try {
          if (isHuman) {
            await sleep(1200);
          }
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

        const lateAnsweredBy = String(liveState.context?.answeredBy || "").toLowerCase();
        if (isVoicemailAnsweredBy(lateAnsweredBy)) {
          console.log(
            "[AI-VOICE] Late AMD flip to voicemail — suppressing speech",
            {
              streamSid: liveState.streamSid,
              callSid: liveState.callSid,
              answeredBy: lateAnsweredBy || "(machine)",
            }
          );
          liveState.voicemailSkipArmed = true;
          safelyCloseOpenAi(liveState, "voicemail detected (late pre-greeting)");
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
              // ✅ STRICT: greeting only, then WAIT (phase enforces next step)
              instructions: buildGreetingInstructions(liveState.context!),
            },
          })
        );
      })();
    }

    return;
  }

  /**
   * ✅ TURN-TAKING: We only create responses on committed user audio.
   * We now enforce:
   *   1) Greeting response (AI) → WAIT
   *   2) On first user reply commit → Script-start response (AI) → WAIT
   *   3) After that, normal response behavior continues
   */
  if (t === "input_audio_buffer.committed") {
    if (state.voicemailSkipArmed) {
      return;
    }

    if (!state.openAiWs || !state.openAiReady) {
      return;
    }

    // If we’re already waiting or speaking, do nothing
    if (state.waitingForResponse || state.aiSpeaking) {
      return;
    }

    // ✅ If we are awaiting the greeting reply, force the “script start” response
    if (state.phase === "awaiting_greeting_reply") {
      state.userAudioMsBuffered = 0;

      setWaitingForResponse(state, true, "response.create (script start)");
      setAiSpeaking(state, true, "response.create (script start)");
      state.outboundOpenAiDone = false;

      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions: buildScriptStartInstructions(state.context!),
          },
        })
      );

      // After we issue the script start response, we consider ourselves "in_call"
      state.phase = "in_call";
      return;
    }

    // Normal behavior for later turns
    state.userAudioMsBuffered = 0;

    setWaitingForResponse(state, true, "response.create (user turn)");
    setAiSpeaking(state, true, "response.create (user turn)");
    state.outboundOpenAiDone = false;

    state.openAiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions:
            'HARD SCOPE LOCK: This call is ONLY about LIFE INSURANCE. Do NOT mention Medicare or any other product.\nHARD ENGLISH LOCK: Speak ONLY English. Do NOT say any Spanish words. If the lead speaks Spanish, respond in English: "I’m sorry — I only speak English. Would you like me to have the licensed agent follow up with you?" Then continue in English.\n\nRespond naturally following all call rules and the script guidance. Keep it short (1–3 sentences), ask one clear question, then stop and wait for the lead to respond.',
        },
      })
    );

    return;
  }

  if (t === "response.audio.delta" || t === "response.output_audio.delta") {
    if (state.voicemailSkipArmed) {
      return;
    }

    setAiSpeaking(state, true, `OpenAI ${t} (audio delta)`);

    let payloadBase64: string | undefined;

    if (typeof event.delta === "string") {
      payloadBase64 = event.delta;
    } else if (event.delta && typeof event.delta.audio === "string") {
      payloadBase64 = event.delta.audio as string;
    }

    if (!payloadBase64) {
      console.warn("[AI-VOICE] audio delta event without audio payload:", event);
    } else {
      const mulawBase64 = pcm16ToMulawBase64(payloadBase64);
      const mulawBytes = Buffer.from(mulawBase64, "base64");

      if (!state.debugLoggedFirstOutputAudio) {
        console.log("[AI-VOICE] First OpenAI audio delta received", {
          streamSid,
          pcmLength: payloadBase64.length,
          mulawBase64Len: mulawBase64.length,
          mulawBytesLen: mulawBytes.length,
          phase: state.phase,
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

    if (state.openAiWs) {
      const humanReadable: string =
        json.humanReadableForLead ||
        "your scheduled appointment time as discussed";

      if (!state.waitingForResponse) {
        state.userAudioMsBuffered = 0;

        setWaitingForResponse(state, true, "response.create (booking confirm)");
        setAiSpeaking(state, true, "response.create (booking confirm)");
        state.outboundOpenAiDone = false;

        state.openAiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: `HARD SCOPE LOCK: This call is ONLY about LIFE INSURANCE. Do NOT mention Medicare or any other product.\nHARD ENGLISH LOCK: Speak ONLY English. Do NOT say any Spanish words.\n\nExplain to the lead, in natural language, that their appointment is confirmed for ${humanReadable}. Then briefly restate what the appointment will cover and end the call politely.`,
            },
          })
        );
      } else {
        console.log(
          "[AI-VOICE] Suppressing booking confirmation response.create because waitingForResponse is already true"
        );
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

  const confirmedDate: string | undefined = control.confirmedDate;
  const confirmedTime: string | undefined = control.confirmedTime;
  const confirmedYes: boolean | undefined = control.confirmedYes;
  const repeatBackConfirmed: boolean | undefined = control.repeatBackConfirmed;

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

    if (typeof confirmedDate === "string" && confirmedDate.trim().length > 0) {
      body.confirmedDate = confirmedDate.trim();
    }
    if (typeof confirmedTime === "string" && confirmedTime.trim().length > 0) {
      body.confirmedTime = confirmedTime.trim();
    }
    if (typeof confirmedYes === "boolean") {
      body.confirmedYes = confirmedYes;
    }
    if (typeof repeatBackConfirmed === "boolean") {
      body.repeatBackConfirmed = repeatBackConfirmed;
    }

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

/**
 * System prompt – insurance only, English by default.
 */
function buildSystemPrompt(ctx: AICallContext): string {
  const aiName = ctx.voiceProfile.aiName || "Alex";
  const clientName = ctx.clientFirstName || "there";

  const agentRawName = ctx.agentName || "your agent";
  const agentFirstName = agentRawName.split(" ")[0] || agentRawName;
  const agentName = agentFirstName;

  const scriptKey = normalizeScriptKey(ctx.scriptKey || "mortgage_protection");

  const basePersona = `
You are ${aiName}, a highly skilled virtual phone appointment setter calling on behalf of licensed life insurance agent ${agentName}.
Your style is inspired by Jeremy Lee Minor: confident, calm, curious, and precise. You sound like a real human assistant, never a robot.

LANGUAGE BEHAVIOR (VERY IMPORTANT)
- You ALWAYS speak clear, natural U.S. English.
- You NEVER speak Spanish or any other language.
- Do NOT open the call with "Hola", bilingual greetings, or any Spanish sentence.
- Even if the lead speaks Spanish, you still respond ONLY in English.
`.trim();

  const compliance = `
COMPLIANCE & RESTRICTIONS (INSURANCE)
- You are NOT a licensed insurance agent.
- You NEVER:
  • Give exact prices, quotes, or rate examples.
  • Recommend specific carriers or products.
  • Say someone is "approved", "qualified", or "definitely eligible".
  • Collect Social Security numbers, banking information, or credit card details.
- You ONLY:
  • Confirm basic context (who coverage is for, basic goals).
  • Explain that the licensed agent will review options and pricing.
  • Set or confirm appointments and simple callbacks.
If the lead pushes for specific details, qualifications, or quotes:
- Reassure them that ${agentName} will cover all of that on the call.
- Gently bring the conversation back to scheduling the appointment.
`.trim();

  const leadContext = `
LEAD CONTEXT
- First name: ${clientName}
- Last name: ${ctx.clientLastName || "(not provided)"}
- State: ${ctx.clientState || "(not provided)"}
- Phone: ${ctx.clientPhone || "(not provided)"}
- Notes: ${ctx.clientNotes || "(none)"}
- Lead type (scriptKey): ${scriptKey}

Always address them by first name: "${clientName}" unless they correct you.
`.trim();

  const agentContext = `
AGENT & TIME CONTEXT
- Agent name (internal): ${agentRawName}
- Agent name (spoken): ${agentName}
- Agent timezone: ${ctx.agentTimeZone}
You do NOT promise exact availability that you don’t have. You offer only realistic times (e.g., "later today or tomorrow") and rely on internal tools to finalize exact slots.
`.trim();

  const voiceTone = `
VOICE & TONE
- Voice ID: ${ctx.voiceProfile.openAiVoiceId} (${ctx.voiceProfile.style})
- Tone: warm, confident, low-pressure.
- Speak at a natural phone pace with short, clear sentences.
- Use natural contractions: I'm, you're, that's, we'll, can't, don't.
- Do NOT use texting slang like "LOL", "OMG", or emojis. Keep it conversational but professional.
`.trim();

  const smallTalk = `
SMALL TALK, "ARE YOU REAL?", AND ORIGIN

FIRST TURN (VERY IMPORTANT)
- Your FIRST spoken turn MUST be:
  • A short, clear greeting, AND
  • One simple question.
- Example first turn:
  "Hey ${clientName}. This is ${aiName}. Can you hear me okay?"
- After this first turn, STOP talking and wait for the lead to respond.
- Do NOT begin the insurance script on the first turn.

IF THEY ASK "WHERE ARE YOU CALLING FROM?" OR "WHO ARE YOU WITH?"
- Only at that point, answer clearly once:
  • "I'm calling from ${agentName}'s office. He's the licensed agent who'll actually go over the information with you."
- After you answer, immediately pivot back into the normal flow.

"ARE YOU REAL?" / "IS THIS A ROBOT?"
- If they ask "Are you a real person?" or "Is this a robot?":
  • "Good question — I'm actually a scheduling assistant that works with ${agentName}'s office. My job is just to make sure you actually get the information you requested and help find a time that works."
- Do NOT claim to be the licensed agent and do not say you are a human if directly asked.
`.trim();

  const mortgageIntro = `
MORTGAGE PROTECTION LEADS
Use this as a flexible framework. Do NOT read word-for-word.

- After the lead responds to your greeting, begin:
  "Hey ${clientName}, this is ${aiName}. I’m calling about the mortgage protection request you put in for your home."
  Then ask ONE question and wait.

Key questions to rotate:
- "Was that mainly for yourself, or you and a spouse as well?"
- "What prompted you to look into this right now?"
- "Are you mainly trying to protect the payment, or just make sure the family is covered in general?"
`.trim();

  const veteranIntro = `
VETERAN LIFE LEADS
- After the lead responds to your greeting, begin:
  "Hey ${clientName}, this is ${aiName}. I’m calling about the veteran life insurance programs you were looking into."
  Then ask ONE question and wait.
`.trim();

  const iulIntro = `
CASH VALUE / IUL LEADS
- After the lead responds to your greeting, begin:
  "Hey ${clientName}, this is ${aiName}. I’m calling about the cash value life insurance request you sent in, the IUL options."
  Then ask ONE question and wait.
`.trim();

  const fexIntro = `
FINAL EXPENSE (AGED) LEADS
- After the lead responds to your greeting, begin:
  "Hey ${clientName}, this is ${aiName}. I’m calling about the final expense life insurance information you requested."
  Then ask ONE question and wait.
`.trim();

  const truckerIntro = `
TRUCKER / CDL LEADS
- After the lead responds to your greeting, begin:
  "Hey ${clientName}, this is ${aiName}. I’m calling about the life insurance information you requested as a truck driver."
  Then ask ONE question and wait.
`.trim();

  const genericIntro = `
GENERIC / CATCH-ALL LIFE LEADS
- After the lead responds to your greeting, begin:
  "Hey ${clientName}, this is ${aiName}. I’m calling about the life insurance information you requested online."
  Then ask ONE question and wait.
`.trim();

  let scriptSection = genericIntro;
  if (scriptKey === "mortgage_protection") {
    scriptSection = mortgageIntro;
  } else if (scriptKey === "veteran_leads") {
    scriptSection = veteranIntro;
  } else if (scriptKey === "iul_cash_value") {
    scriptSection = iulIntro;
  } else if (scriptKey === "final_expense") {
    scriptSection = fexIntro;
  } else if (scriptKey === "trucker_leads") {
    scriptSection = truckerIntro;
  }

  const objections = `
OBJECTION PLAYBOOK (SHORT, NATURAL REBUTTALS)
(unchanged)
`.trim();

  const bookingOutcome = `
BOOKING & OUTCOME SIGNALS (CONTROL METADATA)
(unchanged)
`.trim();

  const convoStyle = `
CONVERSATION STYLE & FLOW

GENERAL TURN-TAKING
- Each time you speak, keep it concise: 1–3 sentences, then pause.
- After you ask a question, stop and let the lead respond.
- Do NOT talk over them.

IMPORTANT:
- The system will handle the first greeting turn separately.
- After the lead responds, you begin the script-start line and then continue the normal discovery → appointment flow.
`.trim();

  return [
    basePersona,
    "",
    compliance,
    "",
    leadContext,
    "",
    agentContext,
    "",
    voiceTone,
    "",
    smallTalk,
    "",
    "===== SCRIPT FOCUS (GUIDANCE, NOT VERBATIM) =====",
    scriptSection,
    "",
    "===== OBJECTION PLAYBOOK =====",
    objections,
    "",
    "===== BOOKING & OUTCOME SIGNALS =====",
    bookingOutcome,
    "",
    "===== CONVERSATION STYLE =====",
    convoStyle,
  ].join("\n\n");
}

export {};
