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

  // ✅ Always ignore explicit outbound frames
  if (track === "outbound") {
    return;
  }

  // ✅ If we have positively identified voicemail, never forward audio / never speak.
  // (Webhook will hang up + chain. This prevents leaving a message.)
  if (state.voicemailSkipArmed) {
    return;
  }

  // ✅ CRITICAL CUTOUT GUARD:
  // If the AI is speaking OR a response is in-flight OR we're actively draining outbound audio,
  // NEVER forward Twilio frames to OpenAI (prevents OpenAI "hearing itself" / barge-in interruptions).
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

  // ✅ If OpenAI rejected session.update (like the temperature minimum), retry ONCE safely.
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
      // resend with our centralized payload (temperature 0.6)
      sendSessionUpdate(state.openAiWs, state, "retry after temp-min error");
      return;
    }

    // Any other error: do not spam. Let call flow end naturally.
    // (We keep Twilio socket alive; no refactors here.)
  }

  if (t === "session.updated" && !state.openAiConfigured) {
    state.openAiConfigured = true;
    state.openAiReady = true;

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
      // If it's voicemail/machine, we DO NOT speak at all (prevents leaving voicemails).
      (async () => {
        try {
          // We only need a couple quick attempts; if AMD isn't ready yet, we proceed as before.
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

          // Arm a local guard so we never forward audio / never create responses
          state.voicemailSkipArmed = true;

          // Close OpenAI to avoid token/audio spend while webhook hangs up + chains next
          safelyCloseOpenAi(state, "voicemail detected pre-greeting");

          return;
        }

        // If AnsweredBy is human, we delay slightly to sound natural
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

        // If a late AMD update flipped to machine, still suppress
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
              // ✅ reinforce scope + English lock at the response level too (strict + explicit)
              instructions:
                'HARD SCOPE LOCK: This call is ONLY about LIFE INSURANCE. Do NOT mention Medicare or any other product.\nHARD ENGLISH LOCK: Speak ONLY English. Do NOT say any Spanish words. If the lead speaks Spanish, respond in English: "I’m sorry — I only speak English. Would you like me to have the licensed agent follow up with you?" Then proceed with the normal call flow in English.\n\nBegin the call now.\nFIRST LINE MUST BE EXACTLY: "Hey (client name)" where (client name) is the lead’s first name.\nThen ask ONE simple question like: "How’s your day going?"\nThen STOP talking and WAIT for the lead to respond. Do not continue the script until you hear the lead.',
            },
          })
        );
      })();
    }

    return;
  }

  if (t === "input_audio_buffer.committed") {
    if (state.voicemailSkipArmed) {
      return;
    }

    if (
      state.openAiWs &&
      state.openAiReady &&
      !state.waitingForResponse &&
      !state.aiSpeaking
    ) {
      state.userAudioMsBuffered = 0;

      setWaitingForResponse(state, true, "response.create (user turn)");
      setAiSpeaking(state, true, "response.create (user turn)");
      state.outboundOpenAiDone = false;

      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {
            // ✅ reinforce scope + English lock at the response level too (strict + explicit)
            instructions:
              'HARD SCOPE LOCK: This call is ONLY about LIFE INSURANCE. Do NOT mention Medicare or any other product.\nHARD ENGLISH LOCK: Speak ONLY English. Do NOT say any Spanish words. If the lead speaks Spanish, respond in English: "I’m sorry — I only speak English. Would you like me to have the licensed agent follow up with you?" Then continue in English.\n\nContinue the conversation following the script guidance.\nRules:\n- Keep it to 1–3 short sentences.\n- Ask ONE clear question.\n- Then STOP and WAIT for the lead to answer.\n- Do NOT monologue.\n- Do NOT ask rapid-fire lists.\n- If you need multiple details, ask ONE question per turn.',
          },
        })
      );
    }
    return;
  }

  if (t === "response.audio.delta" || t === "response.output_audio.delta") {
    // If voicemail skip is armed, ignore all outbound audio entirely
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
              // ✅ reinforce scope + English lock at the response level too
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
function normalizeScriptKey(raw: string): string {
  const k = String(raw || "").trim();

  // ✅ These are the keys your UI/api currently sends:
  // - pages/api/ai-calls/scripts.ts:
  //   mortgage_protection, veterans, iul, fex_default
  // (We also accept legacy aliases so older sessions don’t “fall through”.)
  const lower = k.toLowerCase();

  if (lower === "mortgage_protection") return "mortgage_protection";
  if (lower === "veterans") return "veterans";
  if (lower === "iul") return "iul";
  if (lower === "fex_default") return "fex_default";

  // legacy aliases (older builds / old keys)
  if (lower === "veteran_leads" || lower === "veterans_leads") return "veterans";
  if (lower === "iul_cash_value" || lower === "iul_default") return "iul";
  if (lower === "final_expense" || lower === "fex" || lower === "final_expense_default")
    return "fex_default";

  // default fallback
  return "mortgage_protection";
}

function buildSystemPrompt(ctx: AICallContext): string {
  const aiName = ctx.voiceProfile.aiName || "Alex";
  const clientName = ctx.clientFirstName || "there";

  const agentRawName = ctx.agentName || "your agent";
  const agentFirstName = agentRawName.split(" ")[0] || agentRawName;
  const agentName = agentFirstName;

  const scriptKey = normalizeScriptKey(ctx.scriptKey);

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
  • "Hey ${clientName}" and a short greeting, AND
  • One simple question.
- Example first turn:
  "Hey ${clientName} — it’s ${aiName}. How’s your day going?"
- After this first turn, STOP talking and WAIT for the lead to respond.
- Do NOT continue into the reason for the call until the lead responds.

IF THEY ASK "WHERE ARE YOU CALLING FROM?" OR "WHO ARE YOU WITH?"
- Only at that point, answer clearly once:
  • "I’m calling on behalf of ${agentName}’s office. He’s the licensed agent who’ll actually go over the information with you."
- After you answer, immediately pivot back into the normal flow.

"ARE YOU REAL?" / "IS THIS A ROBOT?"
- If they ask "Are you a real person?" or "Is this a robot?":
  • "Good question — I’m actually a scheduling assistant that works with ${agentName}’s office. My job is just to make sure you get the information you requested and help find a time that works."
- Do NOT claim to be the licensed agent and do not say you are a human if directly asked.
`.trim();

  /**
   * ✅ Mortgage Protection — based on Bryson’s “Mortgage Script”
   *
   * IMPORTANT: We keep the “feel” and flow, but:
   * - We DO NOT claim to be an underwriter.
   * - We DO NOT do long underwriting/health interrogation on the AI call.
   * - We DO a few light qualifiers ONLY if the lead is engaged, then book the agent.
   * - One-question-per-turn. Pause. Wait.
   */
  const mortgageIntro = `
MORTGAGE PROTECTION (BASED ON YOUR SCRIPT — APPOINTMENT-SETTER VERSION)

Core rules:
- One question per turn.
- After every question: STOP and WAIT for the lead’s response.
- Keep each response 1–3 sentences.

FLOW

A) OPENER (AFTER THEY RESPOND TO “How’s your day going?”)
- "Perfect — I’ll be quick."
- "I’m calling about the request you put in for mortgage protection."
- Question: "Was that for yourself, or you and a spouse as well?"

B) DISCOVERY (2 questions)
1) "Were you looking for anything in particular, or mainly just wanting to see what’s out there for you and your family?"
(Stop. Wait.)

2) "Just so I better understand — do you mind walking me through what prompted you to reach out and feel like you might need something like this right now?"
(Stop. Wait. If they go shallow, ask ONE follow-up:)
- "When that crossed your mind, what were you picturing happening that made you say, ‘We should probably look into this’?"
(Stop. Wait.)

C) NORMALIZE + FRAME (short, not a monologue)
- "Okay — that’s what most people say as well."
- "The first part is pretty basic: it’s just to understand what you already have in place, what you’d want to happen if something ever did happen to you, and see if there’s a gap where we could help."
- Question: "Would it help if ${agentName} did a quick call with you and laid out the options clearly?"
(Stop. Wait.)

D) ROLE CLARITY (NO “UNDERWRITER” CLAIMS)
- "Just so you know, I’m not the licensed agent and I can’t quote exact pricing — my job is just to get the basics and line you up with ${agentName}."
- "It doesn’t affect me personally if you get coverage or not — what matters is you’re shown the right information tailored to you, so you can make the best decision for your family."
- Question: "Are you with me on that?"
(Stop. Wait.)

E) LIGHT QUALIFIERS (ONLY if they’re engaged)
Pick ONE at a time:
- "Real quick — are you a smoker or non-smoker?"
(Stop. Wait.)
- "Any major health issues you feel I should mention to ${agentName} before he calls — like heart issues, stroke history, cancer, or diabetes?"
(Stop. Wait.)
- "Ballpark — about how much is left on the mortgage?"
(Stop. Wait.)

F) APPOINTMENT TRANSITION (close like your style)
- "Perfect. The easiest way to handle this is a quick 10–15 minute call with ${agentName}."
- Question: "Do you normally have more time earlier in the day, or later in the evening — if we set that up for today or tomorrow?"
(Stop. Wait.)

If they say they’re busy:
- "No problem — I caught you at a bad time. What’s a better time later today or tomorrow?"
(Stop. Wait.)

If they’re skeptical / push back:
- "Totally fair. If we can’t find something that actually makes sense for you, we’ll fist-bump through the phone as friends — no pressure."
- Question: "What time works better — later today or tomorrow?"
(Stop. Wait.)
`.trim();

  const veteranIntro = `
VETERAN PROGRAMS (APPOINTMENT-SETTER)

- After greeting: "I’m getting back to you about the veteran life insurance programs you were looking into."
- Question 1: "Was that for yourself, or you and a spouse/family as well?"
(Stop. Wait.)
- Question 2: "What made you look into it right now?"
(Stop. Wait.)
- Frame: "I can’t quote exact pricing — ${agentName} is the licensed agent who reviews the options."
- Appointment: "Earlier today or later tomorrow usually better?"
(Stop. Wait.)
`.trim();

  const iulIntro = `
IUL / CASH VALUE (APPOINTMENT-SETTER)

- After greeting: "I’m following up on the request you sent in about the cash-building life insurance options — Indexed Universal Life."
- Question 1: "Were you more focused on building tax-favored savings, protecting income for the family, or a mix?"
(Stop. Wait.)
- Question 2: "What made you look into it right now?"
(Stop. Wait.)
- Frame: "I’m just scheduling — ${agentName} is the licensed agent who’ll cover the details and numbers."
- Appointment: "Earlier today or later tomorrow usually better?"
(Stop. Wait.)
`.trim();

  const fexIntro = `
FINAL EXPENSE (DEFAULT) (APPOINTMENT-SETTER)

- After greeting: "I’m following up on the request you sent in for information on life insurance to cover final expenses."
- Question 1: "Did you ever end up getting anything in place for that, or not yet?"
(Stop. Wait.)
- Question 2: "What made you want to look into it now?"
(Stop. Wait.)
- Frame: "I’m not licensed to quote — ${agentName} will go over options."
- Appointment: "Do mornings or evenings work better for a quick call today or tomorrow?"
(Stop. Wait.)
`.trim();

  const genericIntro = `
GENERIC LIFE (CATCH-ALL)

- After greeting: "I’m getting back to you about the life insurance information you requested online."
- Question 1: "Was that more for final expenses, protecting the mortgage/income, or leaving money behind?"
(Stop. Wait.)
- Question 2: "What made you look into it right now?"
(Stop. Wait.)
- Appointment: "Do you have more time earlier today or later this evening?"
(Stop. Wait.)
`.trim();

  let scriptSection = genericIntro;
  if (scriptKey === "mortgage_protection") {
    scriptSection = mortgageIntro;
  } else if (scriptKey === "veterans") {
    scriptSection = veteranIntro;
  } else if (scriptKey === "iul") {
    scriptSection = iulIntro;
  } else if (scriptKey === "fex_default") {
    scriptSection = fexIntro;
  }

  const objections = `
OBJECTION PLAYBOOK (SHORT, NATURAL REBUTTALS)

General pattern:
1) Validate + agree.
2) Reframe or clarify.
3) Return confidently to the appointment or clear outcome.

1) "I'm not interested"
- "Totally fair. Just so I can close your file the right way — was it more that you already handled it, or you just don’t want a call about it?"
- If they stay cold or ask to stop: set do_not_call / not_interested.

2) "I already have coverage"
- "Perfect — then this is usually just a quick review to make sure it still matches what you want and you’re not overpaying."
- Offer a short review call. Respect a firm no.

3) "I don't remember filling anything out"
- "No worries — it looks like a request for life insurance information came in under your name. Does that ring a bell at all?"
- If not and they don’t want it: mark not_interested.

4) "Can you just text/email me something?"
- "I can send a quick confirmation, but the reason we do a short call is the options depend on age, health, and budget. ${agentName} makes it clear in 10–15 minutes."
- Offer two time windows.

5) "I don't have time, I'm at work"
- "Totally get it — when are you usually in a better spot, mornings or evenings?"
- Set callback/appointment.

Rebuttal limit:
- Use at most 3–4 short rebuttals per call.
- If they say "stop calling", "take me off your list", or sound angry, stop and set do_not_call.
`.trim();

  const bookingOutcome = `
BOOKING & OUTCOME SIGNALS (CONTROL METADATA)

When you successfully agree on an appointment time, you MAY emit:
{
  "kind": "book_appointment",
  "startTimeUtc": "<ISO8601 in UTC>",
  "durationMinutes": 20,
  "leadTimeZone": "<lead timezone>",
  "agentTimeZone": "${ctx.agentTimeZone}",
  "notes": "Short note about what they want and who will be on the call."
}

When the call is clearly finished, emit exactly ONE "final_outcome" payload:

- Booked:
  { "kind": "final_outcome", "outcome": "booked", "summary": "...", "notesAppend": "..." }
- Not interested:
  { "kind": "final_outcome", "outcome": "not_interested", "summary": "...", "notesAppend": "..." }
- Callback later:
  { "kind": "final_outcome", "outcome": "callback", "summary": "...", "notesAppend": "..." }
- No answer:
  { "kind": "final_outcome", "outcome": "no_answer", "summary": "...", "notesAppend": "..." }
- Do not call:
  { "kind": "final_outcome", "outcome": "do_not_call", "summary": "...", "notesAppend": "..." }
- Disconnected:
  { "kind": "final_outcome", "outcome": "disconnected", "summary": "...", "notesAppend": "..." }

"summary" = 1–2 sentences of what happened.
"notesAppend" = 1–3 short note lines, each starting with "* ".
`.trim();

  const convoStyle = `
CONVERSATION STYLE & FLOW

GENERAL TURN-TAKING (NON-NEGOTIABLE)
- Each time you speak: 1–3 sentences MAX.
- Ask ONE question per turn.
- After you ask a question: STOP and WAIT for the lead’s response.
- Do NOT talk over them. If you accidentally do, apologize and let them finish.

OPENING
- First turn must be: "Hey ${clientName}" + ONE short question ("How’s your day going?") then WAIT.
- Only after they respond, state the reason for the call.

APPOINTMENT GOAL
- Your job is to book a short call with ${agentName} today or tomorrow.
- Do NOT do long underwriting. Light qualifiers only if engaged.
- If they are busy, schedule a callback window.

CLOSE & RECAP (when booked)
- Repeat back: Day, Time, Timezone, and that ${agentName} will call.
- End politely. No reselling after booking.
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
