// ai-voice-server/index.ts
import http, { IncomingMessage, ServerResponse } from "http";
import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch";

/**
 * ENV + config
 */
const PORT = process.env.PORT
  ? Number(process.env.PORT)
  : process.env.AI_VOICE_SERVER_PORT
  ? Number(process.env.AI_VOICE_SERVER_PORT)
  : 4000;

// Base URL for your CoveCRM app (prod or ngrok in dev)
const COVECRM_BASE_URL =
  process.env.COVECRM_BASE_URL || "https://www.covecrm.com";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const AI_DIALER_AGENT_KEY = process.env.AI_DIALER_AGENT_KEY || "";

// Approximate your raw vendor cost per minute (Twilio + OpenAI), for analytics
// This does NOT affect what the user is billed (that’s in CoveCRM).
const AI_DIALER_VENDOR_COST_PER_MIN_USD = Number(
  process.env.AI_DIALER_VENDOR_COST_PER_MIN_USD || "0"
);

// OpenAI Realtime
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
// Example model – adjust based on your actual Realtime model
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
const USAGE_URL = new URL(
  "/api/ai-calls/usage",
  COVECRM_BASE_URL
).toString();

/**
 * Types for Twilio <Stream> messages
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
    payload: string; // base64-encoded μ-law 8k audio (g711_ulaw)
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
  fromNumber?: string;
  voiceProfile: {
    aiName: string;
    openAiVoiceId: string;
    style: string;
  };
  raw: {
    session: any;
    user: any;
    lead: any;
  };
};

/**
 * Internal call state for each Twilio <Stream> connection
 */
type CallState = {
  streamSid: string;
  callSid: string;
  context?: AICallContext;

  // OpenAI Realtime connection + buffers
  openAiWs?: WebSocket;
  openAiReady?: boolean;
  pendingAudioFrames: string[]; // base64-encoded g711_ulaw chunks
  finalOutcomeSent?: boolean;

  // Track whether we've appended audio since the last commit
  hasUncommittedAudio?: boolean;

  // Billing
  callStartedAtMs?: number;
  billedUsageSent?: boolean;

  // Debug flags (to avoid log spam)
  debugLoggedFirstMedia?: boolean;
  debugLoggedFirstOutputAudio?: boolean;
};

const calls = new Map<WebSocket, CallState>();

/**
 * Helper: convert OpenAI PCM16 (24k) → μ-law 8k and return base64 string.
 *
 * NOTE:
 * - OpenAI Realtime audio deltas are PCM16 (signed 16-bit, LE) at 24k.
 * - Twilio Media Streams expect G.711 μ-law at 8k.
 * - We do a quick-and-dirty downsample by taking every 3rd sample.
 *   This is fine for phone-quality speech.
 */
function pcm16ToMulawBase64(pcm16Base64: string): string {
  if (!pcm16Base64) return "";

  const pcmBuf = Buffer.from(pcm16Base64, "base64");
  if (pcmBuf.length < 2) return "";

  const sampleCount = Math.floor(pcmBuf.length / 2);
  if (sampleCount <= 0) return "";

  // Downsample 24k → 8k by taking every 3rd sample
  const outSampleCount = Math.ceil(sampleCount / 3);
  const mulawBytes = Buffer.alloc(outSampleCount);

  const BIAS = 0x84;
  const CLIP = 32635;

  const linearToMulaw = (sample: number): number => {
    let sign = (sample >> 8) & 0x80;
    if (sign !== 0) {
      sample = -sample;
    }
    if (sample > CLIP) {
      sample = CLIP;
    }
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

/**
 * HTTP server (for /start-session, /stop-session) + WebSocket server
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

            // Optional: kick CoveCRM AI worker once so dialing starts immediately.
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

            // NOTE:
            //  - Actual stopping of new calls is handled by CoveCRM:
            //    /api/ai-calls/stop.ts marks the AICallSession as "completed",
            //    and the worker only processes sessions in ["queued", "running"].

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

      // Fallback 404 for other HTTP routes
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

// Attach WebSocket server to the same HTTP server/port
const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  console.log("[AI-VOICE] New WebSocket connection");

  const state: CallState = {
    streamSid: "",
    callSid: "",
    pendingAudioFrames: [],
    hasUncommittedAudio: false,
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
 * START: Twilio begins streaming the call
 */
async function handleStart(ws: WebSocket, msg: TwilioStartEvent) {
  const state = calls.get(ws);
  if (!state) return;

  state.streamSid = msg.streamSid;
  state.callSid = msg.start.callSid;
  state.callStartedAtMs = Date.now();
  state.billedUsageSent = false;
  state.hasUncommittedAudio = false;

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

  // Fetch full AI context from CoveCRM
  try {
    const url = new URL("/api/ai-calls/context", COVECRM_BASE_URL);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("leadId", leadId);
    url.searchParams.set("key", AI_DIALER_CRON_KEY);

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
      `[AI-VOICE] Loaded context for ${context.clientFirstName} (agent: ${context.agentName}, voice: ${context.voiceProfile.aiName})`
    );

    // Initialize OpenAI Realtime session
    await initOpenAiRealtime(ws, state);
  } catch (err: any) {
    console.error("[AI-VOICE] Error fetching AI context:", err?.message || err);
  }
}

/**
 * MEDIA: Twilio sends audio frames (μ-law 8k) -> forward to OpenAI
 */
async function handleMedia(ws: WebSocket, msg: TwilioMediaEvent) {
  const state = calls.get(ws);
  if (!state) return;

  const { media } = msg;
  const { payload } = media; // base64 g711_ulaw

  if (!state.debugLoggedFirstMedia) {
    console.log("[AI-VOICE] handleMedia: first audio frame received", {
      streamSid: state.streamSid,
      hasOpenAi: !!state.openAiWs,
      openAiReady: !!state.openAiReady,
      payloadLength: payload?.length || 0,
    });
    state.debugLoggedFirstMedia = true;
  }

  // If OpenAI connection isn't ready yet, temporarily buffer base64 payloads
  if (!state.openAiWs || !state.openAiReady) {
    state.pendingAudioFrames.push(payload);
    return;
  }

  try {
    // We configured OpenAI for g711_ulaw input, so we can forward Twilio's base64 payload directly.
    const event = {
      type: "input_audio_buffer.append",
      audio: payload, // still base64 g711_ulaw
    };
    state.openAiWs.send(JSON.stringify(event));
    state.hasUncommittedAudio = true;
  } catch (err: any) {
    console.error(
      "[AI-VOICE] Error forwarding audio to OpenAI:",
      err?.message || err
    );
  }
}

/**
 * STOP: Twilio ends the stream
 */
async function handleStop(ws: WebSocket, msg: TwilioStopEvent) {
  const state = calls.get(ws);
  if (!state) return;

  console.log(
    `[AI-VOICE] stop: callSid=${msg.stop.callSid}, streamSid=${msg.streamSid}`
  );

  // Tell OpenAI we're done sending audio for this call
  if (state.openAiWs && state.openAiReady) {
    try {
      // Only commit if we've actually appended audio since last commit
      if (state.hasUncommittedAudio) {
        state.openAiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.commit",
          })
        );
        state.hasUncommittedAudio = false;
      }

      // Ask the model to finalize any internal notes / outcome.
      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions:
              "The call has ended; finalize your internal notes and, if appropriate, emit a final_outcome control payload. Do not send any more greeting audio.",
          },
        })
      );
    } catch (err: any) {
      console.error(
        "[AI-VOICE] Error committing OpenAI buffer:",
        err?.message || err
      );
    }
  }

  // Bill for the full duration of this AI dialer call (vendor analytics)
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
 * Initialize OpenAI Realtime WebSocket connection for this call
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
    state.openAiReady = true;

    const ctx = state.context!;
    const systemPrompt = buildSystemPrompt(ctx);

    // Configure the Realtime session:
    //  - Jeremy-Lee-style instructions
    //  - voice
    //  - g711_ulaw audio IN, PCM16 audio OUT
    //  - server-side VAD to detect turns and respond automatically
    const sessionUpdate = {
      type: "session.update",
      session: {
        instructions: systemPrompt,
        voice: ctx.voiceProfile.openAiVoiceId || "alloy",
        // IMPORTANT: audio + text to avoid invalid modalities error
        modalities: ["audio", "text"],
        input_audio_format: "g711_ulaw",
        output_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          // Slightly faster, still human-like: reacts a bit sooner
          threshold: 0.4,
          silence_duration_ms: 800,
          create_response: true,
        },
        // Hard cap so it can't monologue forever on each turn
        max_response_output_tokens: 40,
      },
    };

    try {
      openAiWs.send(JSON.stringify(sessionUpdate));

      // Flush any buffered audio frames we received before the model was ready
      if (state.pendingAudioFrames.length > 0) {
        console.log(
          "[AI-VOICE] Flushing buffered audio frames to OpenAI:",
          state.pendingAudioFrames.length
        );
        for (const base64Chunk of state.pendingAudioFrames) {
          const event = {
            type: "input_audio_buffer.append",
            audio: base64Chunk,
          };
          openAiWs.send(JSON.stringify(event));
          state.hasUncommittedAudio = true;
        }
        state.pendingAudioFrames = [];
      }

      // 🔹 Kick off FIRST TURN only (LOCKED)
      const clientName = ctx.clientFirstName || "there";

      openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions: `
Your ONLY job in this very first spoken response is to say exactly this one short line, then stop talking completely:

"Hey ${clientName}, can you hear me okay?"

Rules for this first response:
- Do NOT introduce yourself.
- Do NOT explain why you're calling.
- Do NOT mention the agent's name.
- Do NOT add extra words, sentences, or sounds.
- After you speak that line once, you must stop and wait silently for the lead's response.
`.trim(),
          },
        })
      );
    } catch (err: any) {
      console.error(
        "[AI-VOICE] Error sending session.update / first response:",
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
      } else {
        console.log(
          "[AI-VOICE] OpenAI event (no type):",
          text.slice(0, 200) + (text.length > 200 ? "..." : "")
        );
      }

      // When the server VAD commits, clear our uncommitted flag
      if (event.type === "input_audio_buffer.committed") {
        const st = calls.get(ws);
        if (st) st.hasUncommittedAudio = false;
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
 * Handle events coming back from OpenAI Realtime.
 *  - Stream audio deltas back to Twilio (with PCM16 → μ-law conversion)
 *  - Detect tool calls / intents for booking + outcomes
 */
async function handleOpenAiEvent(
  twilioWs: WebSocket,
  state: CallState,
  event: any
) {
  const { streamSid, context } = state;
  if (!context) return;

  // 1) Audio back to Twilio
  //    OpenAI → PCM16 → μ-law 8k → Twilio media payload.
  if (
    event.type === "response.audio.delta" ||
    event.type === "response.output_audio.delta"
  ) {
    let payloadBase64: string | undefined;

    if (typeof event.delta === "string") {
      // shape: { type: "response.audio.delta", delta: "<base64 pcm16>" }
      payloadBase64 = event.delta;
    } else if (event.delta && typeof event.delta.audio === "string") {
      // shape: { type: "response.output_audio.delta", delta: { audio: "<base64 pcm16>" } }
      payloadBase64 = event.delta.audio as string;
    }

    if (!payloadBase64) {
      console.warn(
        "[AI-VOICE] audio delta event without audio payload:",
        event
      );
    } else {
      const mulawBase64All = pcm16ToMulawBase64(payloadBase64);

      if (!mulawBase64All) {
        return;
      }

      const mulawBuf = Buffer.from(mulawBase64All, "base64");
      if (!mulawBuf.length) return;

      if (!state.debugLoggedFirstOutputAudio) {
        console.log("[AI-VOICE] Sending first audio chunk to Twilio", {
          streamSid,
          pcmLength: payloadBase64.length,
          mulawLength: mulawBase64All.length,
          bytes: mulawBuf.length,
        });
        state.debugLoggedFirstOutputAudio = true;
      }

      try {
        // Send in ~20ms frames (160 bytes at 8kHz μ-law)
        const FRAME_SIZE = 160;
        for (let offset = 0; offset < mulawBuf.length; offset += FRAME_SIZE) {
          const frame = mulawBuf.subarray(offset, offset + FRAME_SIZE);
          if (!frame.length) continue;

          const frameBase64 = frame.toString("base64");
          const twilioMediaMsg = {
            event: "media",
            streamSid,
            media: {
              payload: frameBase64,
              track: "outbound",
            },
          };

          twilioWs.send(JSON.stringify(twilioMediaMsg));
        }
      } catch (err: any) {
        console.error(
          "[AI-VOICE] Error sending audio to Twilio:",
          err?.message || err
        );
      }
    }
  }

  // 2) Text / tool calls / intents via control metadata (if you decide to use it later)
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
 * Handle a booking intent from the AI
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

    // Format the fromNumber for cementing (10 digits, no leading 1)
    let rawFrom =
      (ctx.fromNumber as string | undefined) ||
      (ctx.raw?.session?.fromNumber as string | undefined) ||
      "";
    let digitsOnly = rawFrom.replace(/\D/g, "");
    if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
      digitsOnly = digitsOnly.slice(1);
    }

    const fromNumberForLead =
      digitsOnly.length === 10 ? digitsOnly : rawFrom || "your normal number";

    // Speak back a strong, human-sounding confirmation + cementing
    if (state.openAiWs) {
      const humanReadable: string =
        json.humanReadableForLead ||
        "your scheduled appointment time as discussed";

      const cementingInstructions = `
The appointment has been successfully booked.

Explain this clearly to the lead in natural language and do ALL of the following:

1) Repeat back the day and time in their timezone using:
   "${humanReadable}"

2) Make it clear that ${ctx.agentName} will be the one calling them.

3) Clearly mention the number the agent will call from, formatted like 0000000000:
   "${fromNumberForLead}"
   - Tell them to save that number in their phone under ${ctx.agentName}'s name
     so they recognize it when it rings.

4) Gently "cement" the appointment by:
   - Reminding them it will be a short call focused on the exact info they requested.
   - Asking them to have their spouse or any decision-maker on the line if applicable.
   - Briefly setting the expectation that if something changes, they can just let you
     or the office know.

5) If it makes sense for this type of lead and your office normally sends reminders,
   you may say a short line like:
   "You'll also get a quick text reminder about this time so you don't have to remember it."

6) End by confirming the commitment with a soft question such as:
   "Does that still work for you?" or "Does that sound fair?"

Keep it warm, confident, and under about 4–6 short sentences. Then wrap up the call politely.
`.trim();

      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions: cementingInstructions,
          },
        })
      );
    }
  } catch (err: any) {
    console.error(
      "[AI-VOICE] Error calling book-appointment endpoint:",
      err?.message || err
    );
  }
}

/**
 * Handle a final outcome intent from the AI
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
    const body = {
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
 * Bill this call's AI Dialer usage based on total stream time
 * (vendor analytics only — user billing is handled in call-status-webhook)
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

  // Convert to minutes (total time the AI dial session was running)
  const rawMinutes = diffMs / 60000;
  // Round to 2 decimals, with a tiny floor so a very short call still counts
  const minutes =
    rawMinutes <= 0 ? 0.01 : Math.round(rawMinutes * 100) / 100;

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
 * System prompt (Jeremy Lee Minor style, appointment-only, full live conversation)
 * - Uses ONLY the agent's first name when speaking.
 * - Enforces short turns and strict 2-step opening behaviour.
 * - Enforces default U.S. English (no Spanish unless explicitly requested).
 */
function buildSystemPrompt(ctx: AICallContext): string {
  const aiName = ctx.voiceProfile.aiName || "Alex";
  const clientName = ctx.clientFirstName || "there";

  // Use ONLY the agent's first name when speaking
  const agentRawName = ctx.agentName || "your agent";
  const agentFirstName = agentRawName.split(" ")[0] || agentRawName;
  const agentName = agentFirstName;

  const scriptKey = ctx.scriptKey || "mortgage_protection";

  // Dynamic descriptor for the second-turn intro line,
  // so mortgage leads don't sound like generic life leads.
  let leadDescriptor =
    "the life insurance information you requested online";
  if (scriptKey === "mortgage_protection") {
    leadDescriptor = "the mortgage protection request you put in for your home";
  } else if (scriptKey === "veteran_leads") {
    leadDescriptor = "the veteran life insurance programs you were looking into";
  } else if (scriptKey === "iul_cash_value" || scriptKey === "iul_leads") {
    leadDescriptor =
      "the cash-building life insurance and Indexed Universal Life information you asked about";
  } else if (scriptKey === "final_expense") {
    leadDescriptor =
      "the life insurance information you requested to cover final expenses";
  } else if (scriptKey === "trucker_leads") {
    leadDescriptor =
      "the life insurance information you requested as a truck driver";
  }

  const basePersona = `
You are ${aiName}, a highly skilled virtual phone appointment setter calling on behalf of licensed life insurance agent ${agentName}.
Your style is inspired by Jeremy Lee Minor: confident, calm, curious, and precise. You sound like a real human assistant, never a robot.

HARD TURN LIMITS (NON-NEGOTIABLE)
- You MUST keep each spoken turn short.
- Max 1–3 short sentences per turn, then STOP talking.
- After you ask a question, you MUST stop speaking and wait for the lead's response.
- Do NOT give long speeches or stack multiple major steps (discovery + objections + booking) into one monologue.
- If you ever feel like you're talking for more than ~6–8 seconds straight, you must wrap up and stop.

LANGUAGE BEHAVIOR
- You ALWAYS speak clear, natural U.S. English by default.
- You NEVER start the call or any part of the call in Spanish or any other language unless the lead clearly and explicitly asks you to switch.
- Do NOT open the call with "Hola", bilingual greetings, or any Spanish sentence on your own.
- Only switch languages if the lead says something like "Can we speak Spanish?" or clearly requests another language. Otherwise, remain in English for the entire call.
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
- Vary your phrasing so you don't sound repetitive across the call.
- Allow small, realistic pauses between sentences; don't talk in a perfectly even rhythm.
- Avoid filler like "as an AI" or anything that sounds robotic or scripted.
- Use phrases like: "fair enough", "that makes sense", "would it be crazy if…", "does that sound fair?".
- Do NOT use texting slang like "LOL", "OMG", or emojis. Keep it conversational but professional.
`.trim();

  const smallTalk = `
SMALL TALK, HUMOR, AND HUMAN-LIKE BEHAVIOR

FIRST TWO TURNS (EXTREMELY IMPORTANT)
You must follow this exact pattern for the first two turns of the call:

1) FIRST TURN (audio check only)
   - Your first spoken turn is pre-configured separately and will be:
     "Hey ${clientName}, can you hear me okay?"
   - You say that once, then stop and wait. You must NOT add anything else.

2) SECOND TURN (intro + reason + simple question)
   - ONLY AFTER they respond to your audio check, your second spoken turn should be exactly ONE short sentence:
     "Hey ${clientName}, this is ${aiName} calling about ${leadDescriptor}. How's your day going so far?"
   - You must NOT add any extra sentences, disclaimers, jokes, or filler in this second turn.
   - After you ask "How's your day going so far?", STOP speaking and wait again for their response.

3) DO NOT:
   - Do NOT combine the audio check and the full intro into one long monologue.
   - Do NOT mention that you're calling from ${agentName}'s office in your first or second turn.
   - Do NOT mention the appointment length (10–15 minutes) in the first two turns.
   - Do NOT start explaining the full process or script in the first two turns.

ONLY AFTER the first two turns are complete may you transition into your normal discovery questions and script for this lead type.

IF THEY ASK "WHERE ARE YOU CALLING FROM?" OR "WHO ARE YOU WITH?"
- Only at that point, answer clearly once:
  • "I'm calling from ${agentName}'s office. He's the licensed agent who'll actually go over the information with you."
- After you answer, immediately pivot back into the normal flow of confirming their situation and booking the appointment.
- Do NOT volunteer "I'm calling from ${agentName}'s office" unless they ask.

SMALL TALK
- If they ask "How are you?" or "How's your day going?":
  • Answer briefly and positively: "It's going great so far, thanks for asking. How about you?"
  • After they answer, gently pivot back into the reason for the call and booking.

LIGHT HUMOR
- If they make a light joke (about age, forgetting, busy schedule, etc.):
  • You may respond with a short, natural laugh line, like:
    - "Haha, I totally get that."
    - "Yeah, I hear that a lot."
  • Keep it quick and then move the conversation forward.
- Never be goofy, sarcastic, or overly playful. The humor should be a seasoning, not the main dish.

"ARE YOU REAL?" / "IS THIS A ROBOT?"
- If they ask "Are you a real person?" or "Is this a robot?":
  • Be honest and reassuring. Example:
    - "Good question — I'm actually a scheduling assistant that works with ${agentName}'s office. My job is just to make sure you actually get the information you requested and help find a time that works."
  • Then pivot back to the purpose of the call and booking.
- Do NOT claim to be the licensed agent and do not say you are a human if directly asked. You are a scheduling assistant for ${agentName}.

"HOW DID YOU GET MY INFORMATION?"
- Answer calmly and clearly:
  • "I'm calling because you requested information online about life insurance for [your home / final expenses / veterans program]. My job is just to follow up on that request and get you in front of ${agentName} so they can go over your options."
- If they genuinely do not remember and stay skeptical after a brief explanation, you may politely offer to close out their request and mark them as not interested.

CAN’T HEAR / BACKGROUND NOISE
- If audio is unclear:
  • Say: "Sorry, I missed that. Could you say that one more time for me?"
  • You may ask them once or twice to repeat or move to a quieter spot.
- If it remains impossible to communicate, politely explain you’re having trouble hearing and set the final outcome to "disconnected" or "callback" depending on what makes more sense.

EMOTION & EMPATHY
- If they sound stressed, busy, or frustrated:
  • Acknowledge it briefly: "Totally understand, sounds like you've got a lot going on."
  • Then either:
    - Offer a quick appointment/callback time, or
    - Respect their wish to end the call and set an appropriate final outcome.
- If they mention a loss or serious health issue:
  • Respond with short, real empathy:
    - "I'm really sorry to hear that."
    - "I appreciate you sharing that with me."
  • Then keep your tone gentle and do NOT pry with unnecessary questions.

DO NOT:
- Do NOT argue, lecture, or become defensive.
- Do NOT overshare about yourself; keep the focus on them and the appointment.
- Do NOT drag out small talk. Use it to build rapport, then move forward.
`.trim();

  //
  // SCRIPT FRAMEWORKS
  //

  const mortgageIntro = `
MORTGAGE PROTECTION LEADS
Use this as a flexible framework. Do NOT read word-for-word.

CORE FLOW

1) OPENER & REASON FOR CALL
- After your first two required opening turns are done, you can say:
  "I'm just giving you a quick call about the request you put in for mortgage protection on your home."
- Clarify who coverage is for:
  "Was that just for yourself, or were you thinking about you and a spouse as well?"

2) QUESTION 1 – SURFACE-LEVEL INTENT
- "Were you looking for anything in particular with the coverage, or mainly just wanting to see what was out there for you and your family?"

3) QUESTION 2 – DEEPER REASON / MOTIVATION
- "Got it, that makes sense. Just so I better understand, do you mind kind of walking me through your mind on what prompted you to reach out and feel like you might need something like this right now?"

4) NORMALIZE & FRAME THE GAP
- Acknowledge them and relate:
  "Okay, that's what most clients say as well."
- Then frame the first part of the process:
  "The first part of this is actually pretty simple – it's really just to figure out what you have in place now if something happens to you, what you'd like it to do for your family, and then see if there's any gap where we might be able to help."

5) POSITION YOUR ROLE (NOT A CLOSER)
- "My role is just to collect the basics and then line you up with ${agentName}, who's the licensed specialist."
- "They look through the top carriers in your state to see who might give you the best fit and rates."
- "I'm not the salesperson and I'm not here to tell you what to do. It doesn't affect me personally if you get coverage, don't get coverage, or how much you do."
- "What does matter is that you're at least shown the right information tailored to you specifically so you can make the best decision for your family. Does that sound fair?"

6) APPOINTMENT TRANSITION
- IMPORTANT: You only move into this part AFTER they have answered your earlier questions and still sound engaged.
- "Perfect. These calls with ${agentName} are usually around 10–15 minutes."
- "They just walk you through what you might qualify for and what it would look like on the budget."
- Move to time options:
  "Do you normally have more time earlier in the day or later in the evening if we were to set that up either today or tomorrow?"

7) LOCKING IN THE TIME
- Narrow down a specific day/time in the next 24–48 hours.
- Confirm any spouse/decision-maker should be present.
- Recap clearly:
  "Okay, so we'll have you set for [DAY] at [TIME] your time. ${agentName} will give you a quick call at this number to walk through everything. Just make sure you and any other decision-maker can be available for about 10–15 minutes. Does that work?"
`.trim();

  const veteranIntro = `
VETERAN LIFE LEADS
Use this as a flexible framework. Do NOT read word-for-word.

1) OPENER & REASON FOR CALL
- After your two required opening turns:
  "I'm just getting back to you about the veteran life insurance programs you were looking into."

2) CLARIFY WHO COVERAGE IS FOR
- "When you sent that request in, was that more just for yourself, or were you thinking about you and a spouse or family as well?"

3) QUESTION 1 – SURFACE INTENT
- "Were you looking for anything in particular with the coverage, or mainly just wanting to see what options are out there for veterans specifically?"

4) QUESTION 2 – DEEPER REASON
- "Gotcha. And just so I better understand where you're coming from, do you mind walking me through what prompted you to reach out and feel like you might need something like this right now?"

5) NORMALIZE & FRAME
- "That makes sense. A lot of veterans we talk to say the same thing – they just want to make sure that if something does happen, their family isn't stuck trying to figure it all out."

6) POSITION YOUR ROLE
- "My job is pretty simple – I just make sure you actually get the information you requested and then line you up with ${agentName}, who specializes in these veteran programs."
- "They'll look at what you might qualify for and how it could fit your budget."
- "I'm not the salesperson and I'm not here to push anything on you. It doesn't affect me personally whether you start a policy or not. What matters is that you see the right options so you can make the best call for you and your family. Does that sound fair?"

7) APPOINTMENT SETTING
- "Perfect. The easiest thing is a quick 10–15 minute call with ${agentName}."
- "They'll go over what you might qualify for and answer your questions."
- Time options:
  "Do you usually have more time earlier in the day or later in the evening if we set that up either today or tomorrow?"
`.trim();

  const iulIntro = `
CASH VALUE / IUL (INDEXED UNIVERSAL LIFE) LEADS
Use this as a flexible framework. Do NOT read word-for-word.

1) OPENER & REASON FOR CALL
- After your two required opening turns:
  "I'm following up on the request you sent in about the cash-building life insurance, the Indexed Universal Life options. Does that ring a bell?"

2) CLARIFY FOCUS
- "When you were looking into that, were you more focused on building tax-favored savings, protecting income for the family, or kind of a mix of both?"

3) QUESTION 1 – SURFACE INTENT
- "Were you mainly just trying to see what's possible with that type of plan, or did you already have a certain goal in mind for that money down the road?"

4) QUESTION 2 – DEEPER MOTIVATION
- "Gotcha. And just so I really understand, can you walk me through what made you feel like you might need something like this versus just keeping everything in a regular account?"

5) NORMALIZE & FRAME
- "That actually makes a lot of sense. Most people that ask about IULs are trying to protect what they're building and also not get crushed on taxes later on."

6) POSITION YOUR ROLE
- "My role here is just to get the basics from you and then get you on a short call with ${agentName}, who's the licensed specialist."
- "They'll map out what you could reasonably qualify for and how it might line up with your goals."
- "I'm not the one designing the plan or telling you what to do. My job is just to make sure you actually get in front of the right person with numbers that make sense for your situation. Does that sound fair?"

7) APPOINTMENT SETTING
- "Perfect. Those calls are usually around 15 minutes."
- "Would you normally have more time earlier in the day or later in the evening if we set that up either today or tomorrow?"
`.trim();

  const fexIntro = `
AGED FINAL EXPENSE (FEX) LEADS
Use this as a flexible framework. Do NOT read word-for-word.

1) OPENER & FILE REFERENCE
- After your two required opening turns:
  "I'm looking at a request you sent in a while back for information on life insurance to cover final expenses."
- "Did you ever end up getting anything in place for that, or not yet?"

2) BRANCH A – THEY ALREADY HAVE COVERAGE
- If they say they DO have coverage:
  - "Perfect, that actually helps."
  - "The reason I'm calling is it looks like in your file there may still be some room to review it."
  - "I'm not the licensed agent, so I can't see everything behind the scenes, but what we usually do is a quick 10–15 minute review with ${agentName} just to see if there's any way to improve what you have or possibly save you some money."
  - "Worst case it stays the same, best case you end up in a better spot. Would you be open to a quick review like that?"

3) BRANCH B – THEY DO NOT HAVE COVERAGE
- If they say they do NOT have coverage:
  - "Got it, that actually makes it simple."
  - "The easiest thing is to set up a short call with ${agentName} so they can show you what you might qualify for and what it would look like on the budget."

4) QUESTION 1 – SURFACE INTENT
- "When you first reached out, were you mainly trying to make sure funeral and burial costs weren't left on the family, or were you also trying to leave a little extra behind for them?"

5) QUESTION 2 – DEEPER REASON
- "Okay, that makes sense. Just so I understand where your mind is, what made you feel like you needed to look at this now instead of just putting it off?"

6) POSITION YOUR ROLE
- "My role is just to get those basics noted and then match you with ${agentName} for that short call."
- "I'm not the one who decides what you should do, I just want to make sure you see clear options so if something happens, your family isn't stuck trying to figure out how to pay for everything."
- "Does that sound fair?"

7) APPOINTMENT SETTING
- "Perfect. Those calls are about 10–15 minutes."
- "Do you usually have more time earlier in the day or later in the evening if we set that up either today or tomorrow?"
`.trim();

  const truckerIntro = `
TRUCKER / CDL LEADS
Use this as a flexible framework. Do NOT read word-for-word.

1) OPENER & SITUATION
- After your two required opening turns:
  "I'm just getting back to you about the life insurance information you requested as a truck driver. Are you out on the road right now or are you at home?"
- Acknowledge their answer:
  - "Gotcha, makes sense, your schedule's probably all over the place."

2) QUESTION 1 – SURFACE INTENT
- "When you were looking into that, was your main concern protecting your income for the family if something happens while you're on the road, more about final expenses, or a little bit of both?"

3) QUESTION 2 – DEEPER MOTIVATION
- "Got it. And just so I really understand, do you mind walking me through what made you feel like you might need something like this right now?"

4) NORMALIZE & FRAME
- "That's exactly what a lot of truck drivers tell us – you're gone a lot, and you want to make sure if something happens, your family doesn't get blindsided financially."

5) POSITION YOUR ROLE
- "My job is to keep this really simple for you."
- "I just gather a couple of basics and then line you up with ${agentName}, who works a lot with truck drivers."
- "They'll do a quick 10–15 minute call – no long presentation – just what you could qualify for and what fits the budget."
- "I'm not here to pressure you either way; I just want to make sure you get the information you asked for. Does that sound fair?"

6) APPOINTMENT TIMING AROUND THEIR SCHEDULE
- "When are you usually in a spot where you can talk for 10–15 minutes without rolling – more in the mornings, afternoons, or later evenings?"
- "Let's grab a time in the next day or two while it's on your mind."
`.trim();

  const genericIntro = `
GENERIC LIFE / CATCH-ALL LEADS
Use this when the scriptKey isn't recognized. Do NOT read word-for-word.

1) OPENER & REASON FOR CALL
- After your two required opening turns:
  "I'm just getting back to you about the life insurance information you requested online."

2) CLARIFY GOAL / TYPE OF COVERAGE
- "When you were looking into that, were you mainly trying to:
    • cover funeral and final expenses,
    • protect the mortgage or your income,
    • or just leave some money behind for the family?"

3) QUESTION 1 – SURFACE INTENT
- "Were you just wanting to see what's out there on that, or did you already have a certain idea or concern in mind?"

4) QUESTION 2 – DEEPER MOTIVATION
- "Gotcha. And what was it that made you feel like you needed to look at this now instead of just putting it off?"

5) FRAME THE PROCESS
- "That makes total sense, and honestly that's what most people say too."
- "The first part of this is just figuring out what you have in place now (if anything), what you're actually trying to accomplish, and then seeing if there's a gap where we can help."

6) POSITION YOUR ROLE
- "My job is just to get those basics noted and then get you on a short call with ${agentName}, who's the licensed specialist."
- "They'll walk you through what you might qualify for and how it could work with your budget."
- "I'm not here to pressure you one way or the other – I just want to make sure you have real options to look at. Does that sound fair?"

7) APPOINTMENT SETTING
- "Perfect. Those calls are usually 10–15 minutes."
- "Do you usually have more time earlier in the day or later in the evening if we set that up either today or tomorrow?"
`.trim();

  let scriptSection = genericIntro;
  if (scriptKey === "mortgage_protection") {
    scriptSection = mortgageIntro;
  } else if (scriptKey === "veteran_leads") {
    scriptSection = veteranIntro;
  } else if (scriptKey === "iul_cash_value" || scriptKey === "iul_leads") {
    scriptSection = iulIntro;
  } else if (scriptKey === "final_expense") {
    scriptSection = fexIntro;
  } else if (scriptKey === "trucker_leads") {
    scriptSection = truckerIntro;
  }

  const objections = `
OBJECTION PLAYBOOK (USE SHORT, NATURAL REBUTTALS)

General pattern (never sound scripted):
1) Validate + agree.
2) Reframe or clarify.
3) Return confidently to the appointment or a clear outcome.

Keep rebuttals short: usually 1–2 sentences, then pause and let them respond.

Use conversational language. Examples:

1) "I'm not interested"
- "Totally fair, a lot of people say that at first. Just so I can close your file the right way — was it more that the price didn’t feel right, or it just wasn’t explained clearly?"
- If they stay cold after a few honest attempts, politely exit and use final_outcome = "not_interested" (or "do_not_call" if they ask you not to call again).

2) "I already have coverage"
- "Perfect, that’s actually why I’m calling. The main goal is just making sure you’re not overpaying and that the benefits still match what you want."
- Then offer a quick 10–15 minute review call with ${agentName}. If they refuse again after a few tries, respect it and mark not_interested.

3) "I don't remember filling anything out"
- "No worries at all — I barely remember what I had for breakfast some days. It looks like this came in when you were looking at coverage to [cover final expenses / protect the home / leave money behind]. Does that ring a bell at all?"
- If they honestly don’t remember and don’t want to talk, politely resolve and set final_outcome = "not_interested".

4) "Can you just mail me something?" or "I was just shopping around"
- "That makes sense — you just wanted to see what’s out there. The only reason we do a short call instead of mailing generic brochures is everything is based on age, health, and budget. ${agentName} does a quick 10–15 minute call so what you see are real numbers you could actually qualify for."
- Then offer two specific time options in the next 48 hours.

5) "I don't have time, I'm at work"
- "Totally get it, I caught you at a bad time. When are you usually in a better spot — more in the mornings or evenings?"
- Offer a couple of specific time windows and set a callback appointment (outcome = "callback" if they don’t lock anything in).

6) "I'll just use savings / 401k / my family will handle it"
- Acknowledge their preparation.
- Reframe: the policy is there so they don’t have to drain what they’ve built or put all the pressure on family while they’re grieving.
- Then gently move back to a short review call.

REBUTTAL LIMITS & RESPECT
- You may use up to 3–4 SHORT, respectful rebuttals in total on a call, as long as the lead still sounds calm and engaged.
- If at any point they:
  • Say "stop calling", "take me off your list", or clearly ask not to be called, OR
  • Sound angry, very annoyed, or impatient,
  you IMMEDIATELY back off, apologize briefly, and set final_outcome = "do_not_call" or "not_interested" as appropriate.
- Never argue or become pushy. Your job is persistent but respectful follow-up, not pressure.
`.trim();

  const bookingOutcome = `
BOOKING & OUTCOME SIGNALS (CONTROL METADATA)

When you successfully agree on an appointment time:
- You MAY emit a control payload (metadata) for booking, for example:
  {
    "kind": "book_appointment",
    "startTimeUtc": "<ISO8601 in UTC>",
    "durationMinutes": 20,
    "leadTimeZone": "<lead timezone>",
    "agentTimeZone": "${ctx.agentTimeZone}",
    "notes": "Short note about what they want and who will be on the call."
  }

FINAL OUTCOME + NOTES FORMAT

When the call is clearly finished, you SHOULD emit exactly ONE final outcome payload.
Use both:
- "summary": 1–2 short sentences describing what happened on the call.
- "notesAppend": 1–3 bullet-style note lines that can be added directly to the lead’s notes in the CRM.

"summary" examples:
- "Lead asked for basic quotes and booked a call with ${agentName} for tomorrow at 4:30pm EST."
- "Lead requested a callback next week; currently busy with work."

"notesAppend" style (VERY IMPORTANT):
- Use short, human-readable note lines.
- Start each line with "* " (asterisk + space).
- Keep the entire notesAppend text under ~200 characters total.
- Include ALL of the following when possible:
  • The AI voice name (e.g. "Iris" or "Jacob"),
  • Today’s date in MM/DD format (e.g. "12/11"),
  • The key outcome (booked, callback, no answer, not interested, etc.),
  • 1 important detail they shared (wants quotes, has coverage, spouse on call, etc).

"notesAppend" examples:
- "* Iris 12/11 – booked for 4:30pm EST with spouse on, wants to compare current mortgage plan."
- "* Jacob 12/11 – asked for callback tonight, busy at work, wants basic quotes only."
- "* Iris 12/11 – no answer, left brief voicemail about life insurance info they requested."

When the call is clearly finished, pick the appropriate outcome and send something like:

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

These objects should appear in your message metadata so the orchestration server can read and act on them.
Do NOT emit multiple conflicting final_outcome payloads on a single call.
`.trim();

  const convoStyle = `
CONVERSATION STYLE & FLOW

GENERAL TURN-TAKING
- Each time you speak, keep it concise: usually 1–3 short sentences, then pause.
- Do NOT stack multiple major steps (greeting + discovery + appointment details) into one long monologue.
- After you ask a question, stop and let the lead fully respond.
- Allow a natural 0.3–0.7 second pause before speaking after they finish, so you feel more human and less instant.

1) OPENING
- Follow the required first two turns exactly as described earlier:
  • Turn 1: "Hey ${clientName}, can you hear me okay?"
  • Turn 2: "Hey ${clientName}, this is ${aiName} calling about ${leadDescriptor}. How's your day going so far?"
- Only AFTER those two turns are complete, confirm they have a moment to talk and transition into discovery.

2) DISCOVERY (2–3 questions only)
- Clarify who the coverage would be for (self, spouse, family).
- Clarify the main goal: final expenses, mortgage, income protection, leaving money behind, etc.
- Use answers to make the appointment feel relevant and personalized.

3) TRANSITION TO APPOINTMENT
- Only move into this part AFTER:
  • You have asked at least one discovery question,
  • You have acknowledged their answer, and
  • They still sound reasonably engaged.
- Then keep it simple:
  "The easiest way to do this is a quick 10–15 minute call with ${agentName}. They’ll walk you through what you qualify for and what makes sense. Would earlier today or later this evening usually work better for you?"

4) HANDLE OBJECTIONS (3–4 MAX)
- Use the objection playbook above.
- You can give up to 3–4 short, natural rebuttals across the entire call, as long as the lead stays reasonably friendly and engaged.
- If they clearly want off the phone, seem angry, or ask not to be called:
  • Stop rebutting.
  • Acknowledge them briefly.
  • Set a clean final outcome (usually "not_interested" or "do_not_call").

5) CLOSE & RECAP (WHEN BOOKED)
- Repeat back:
  • Day & date
  • Time and timezone
  • That ${agentName} will call them directly
  • Any spouse/decision-maker who should be present
- Example:
  "Perfect, so we’ve got you set for Tuesday at 6:30 your time. ${agentName} will give you a quick call at this number to walk through the options and answer any questions. Just make sure you and your spouse are both available for about 15–20 minutes. Does that still work for you?"
- After confirming, do NOT keep selling or re-explaining. End the call politely and confidently.

Legal / time window:
- If you learn it’s clearly outside 8am–9pm in the lead’s local time, do not continue a long sales conversation. Either set a callback or wrap quickly and mark the appropriate outcome.

DO NOT TALK OVER THEM
- Allow the lead to fully finish their sentence before you speak.
- If you accidentally interrupt, immediately apologize and let them finish:
  "Sorry, go ahead — I didn’t mean to cut you off."
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
    "===== SCRIPT FOCUS (do NOT read verbatim; use as guidance) =====",
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
