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
  openAiReady?: boolean;
  pendingAudioFrames: string[];
  finalOutcomeSent?: boolean;

  callStartedAtMs?: number;
  billedUsageSent?: boolean;

  debugLoggedFirstMedia?: boolean;
  debugLoggedFirstOutputAudio?: boolean;

  // TURN + COST CONTROL
  waitingForResponse?: boolean; // we have sent response.create and are waiting
  aiSpeaking?: boolean; // AI is currently speaking back to Twilio
  userAudioMsBuffered?: number; // total ms of user audio seen in this turn

  // ✅ Reliability: guard initial greeting so timing logic can't double-send
  initialGreetingQueued?: boolean;
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
 * START
 */
async function handleStart(ws: WebSocket, msg: TwilioStartEvent) {
  const state = calls.get(ws);
  if (!state) return;

  state.streamSid = msg.streamSid;
  state.callSid = msg.start.callSid;
  state.callStartedAtMs = Date.now();
  state.billedUsageSent = false;
  state.waitingForResponse = false;
  state.aiSpeaking = false;
  state.userAudioMsBuffered = 0;
  state.initialGreetingQueued = false;

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
      `[AI-VOICE] Loaded context for ${context.clientFirstName} (agent: ${context.agentName}, voice: ${context.voiceProfile.aiName})`
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

  // Track approximate user audio duration (20ms per frame)
  state.userAudioMsBuffered = (state.userAudioMsBuffered || 0) + 20;

  if (!state.debugLoggedFirstMedia) {
    console.log("[AI-VOICE] handleMedia: first audio frame received", {
      streamSid: state.streamSid,
      hasOpenAi: !!state.openAiWs,
      openAiReady: !!state.openAiReady,
      payloadLength: payload?.length || 0,
    });
    state.debugLoggedFirstMedia = true;
  }

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

  // COST CONTROL: call is over — don't commit buffers or generate any final OpenAI response.
  // Closing the OpenAI socket avoids extra post-hangup generation and eliminates
  // input_audio_buffer_commit_empty errors.
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
    state.openAiReady = true;

    const systemPrompt = buildSystemPrompt(state.context!);

    const sessionUpdate = {
      type: "session.update",
      session: {
        instructions: systemPrompt,

        // Audio-only session
        modalities: ["audio"],
        voice: state.context!.voiceProfile.openAiVoiceId || "alloy",

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

    try {
      openAiWs.send(JSON.stringify(sessionUpdate));

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
        }
        state.pendingAudioFrames = [];
      }

      // Initial greeting – guarded so we don't send multiple on reconnects
      if (!state.waitingForResponse && !state.initialGreetingQueued) {
        state.initialGreetingQueued = true;

        const answeredBy = String(state.context?.answeredBy || "").toLowerCase();
        const isHuman = answeredBy === "human";

        // ✅ ONLY AUDIO-RELATED CHANGE ALLOWED:
        // Delay BEFORE first AI utterance ONLY when AnsweredBy=human, only at call start.
        (async () => {
          try {
            if (isHuman) {
              await sleep(1200);
            }
          } catch {}

          // If call already ended / socket closed / another response started, do nothing.
          const liveState = calls.get(ws);
          if (!liveState || !liveState.openAiWs || liveState.waitingForResponse) {
            return;
          }

          liveState.waitingForResponse = true;
          liveState.aiSpeaking = true;

          liveState.openAiWs.send(
            JSON.stringify({
              type: "response.create",
              response: {
                instructions:
                  "Begin the call now and greet the lead following the call rules. Keep it to one or two short sentences and end with a simple question like 'How's your day going so far?' Then stop speaking and wait for the lead to respond before continuing.",
              },
            })
          );
        })();
      } else {
        console.log(
          "[AI-VOICE] Suppressing initial greeting response.create because waitingForResponse is already true or greeting already queued"
        );
      }
    } catch (err: any) {
      console.error(
        "[AI-VOICE] Error sending session.update / initial greeting:",
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

  // When a response finishes, allow the next one
  if (
    event.type === "response.completed" ||
    event.type === "response.output_audio.done" ||
    event.type === "response.audio.done"
  ) {
    state.waitingForResponse = false;
    state.aiSpeaking = false;
  }

  // AUDIO BACK TO TWILIO (UNCHANGED PATH)
  if (
    event.type === "response.audio.delta" ||
    event.type === "response.output_audio.delta"
  ) {
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

      if (!state.debugLoggedFirstOutputAudio) {
        console.log("[AI-VOICE] Sending first audio chunk to Twilio", {
          streamSid,
          pcmLength: payloadBase64.length,
          mulawLength: mulawBase64.length,
        });
        state.debugLoggedFirstOutputAudio = true;
      }

      try {
        const twilioMediaMsg = {
          event: "media",
          streamSid,
          media: {
            payload: mulawBase64,
            track: "outbound",
          },
        };

        twilioWs.send(JSON.stringify(twilioMediaMsg));
      } catch (err: any) {
        console.error(
          "[AI-VOICE] Error sending audio to Twilio:",
          err?.message || err
        );
      }
    }
  }

  // Control metadata (booking/outcome)
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
        state.waitingForResponse = true;
        state.aiSpeaking = true;
        state.openAiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: `Explain to the lead, in natural language, that their appointment is confirmed for ${humanReadable}. Then briefly restate what the appointment will cover and end the call politely.`,
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

  // ✅ Cementing fields (schema only; no script changes)
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

    // Only include confirmation fields if present so we don't overwrite prior info server-side
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
  // (UNCHANGED - entire function remains exactly as you provided)
  const aiName = ctx.voiceProfile.aiName || "Alex";
  const clientName = ctx.clientFirstName || "there";

  const agentRawName = ctx.agentName || "your agent";
  const agentFirstName = agentRawName.split(" ")[0] || agentRawName;
  const agentName = agentFirstName;

  const scriptKey = ctx.scriptKey || "mortgage_protection";

  const basePersona = `
You are ${aiName}, a highly skilled virtual phone appointment setter calling on behalf of licensed life insurance agent ${agentName}.
Your style is inspired by Jeremy Lee Minor: confident, calm, curious, and precise. You sound like a real human assistant, never a robot.

LANGUAGE BEHAVIOR (VERY IMPORTANT)
- You ALWAYS speak clear, natural U.S. English by default.
- You NEVER start the call or any part of the call in Spanish or any other language unless the lead clearly and explicitly asks you to switch.
- Do NOT open the call with "Hola", bilingual greetings, or any Spanish sentence on your own.
- Only switch languages if the lead clearly requests another language. Otherwise, remain in English for the entire call.
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
  "Hey ${clientName}, this is ${aiName} calling about the request you sent in for life insurance information. How's your day going so far?"
- After this first turn, STOP talking and wait for the lead to respond.
- Do NOT mention:
  • "I'm calling from ${agentName}'s office" in your default intro, and
  • The appointment length on the first turn.
- Only talk about appointment length AFTER you have asked at least one discovery question, listened to their answer, and they still sound engaged.

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

1) OPENER & REASON FOR CALL
- "Hey ${clientName}, this is ${aiName}. How's your day going so far?"
- Then:
  "I'm just giving you a quick call about the request you put in for mortgage protection on your home."
- "Was that just for yourself, or were you thinking about you and a spouse as well?"

2) QUESTION 1 – SURFACE-LEVEL INTENT
- "Were you looking for anything in particular with the coverage, or mainly just wanting to see what was out there for you and your family?"

3) QUESTION 2 – DEEPER REASON
- "Just so I better understand, do you mind kind of walking me through your mind on what prompted you to reach out and feel like you might need something like this right now?"

4) NORMALIZE & FRAME
- "Okay, that's what most clients say as well."
- "The first part of this is actually pretty simple – it's really just to figure out what you have in place now if something happens to you, what you'd like it to do for your family, and then see if there's any gap where we might be able to help."

5) POSITION YOUR ROLE
- "My role is just to collect the basics and then line you up with ${agentName}, who's the licensed specialist."
- "I'm not the salesperson and I'm not here to tell you what to do. It doesn't affect me personally if you get coverage, don't get coverage, or how much you do."
- "What does matter is that you're at least shown the right information tailored to you specifically so you can make the best decision for your family. Does that sound fair?"

6) APPOINTMENT TRANSITION
- Only after they have answered and still sound engaged:
  "Perfect. These calls with ${agentName} are usually around 10–15 minutes."
  "Do you normally have more time earlier in the day or later in the evening if we were to set that up either today or tomorrow?"
`.trim();

  const veteranIntro = `
VETERAN LIFE LEADS
1) OPENER
- "Hey ${clientName}, this is ${aiName}. I'm just getting back to you about the veteran life insurance programs you were looking into. How's your day going so far?"

2) WHO COVERAGE IS FOR
- "Was that more just for yourself, or were you thinking about you and a spouse or family as well?"

3) QUESTION 1 – INTENT
- "Were you looking for anything in particular with the coverage, or mainly just wanting to see what options are out there for veterans specifically?"

4) QUESTION 2 – REASON
- "Do you mind walking me through what prompted you to reach out and feel like you might need something like this right now?"

5) POSITION & APPOINTMENT
- Explain your role and that ${agentName} specializes in these veteran programs.
- Move to a 10–15 minute call later today or tomorrow.
`.trim();

  const iulIntro = `
CASH VALUE / IUL LEADS
1) OPENER
- "Hey ${clientName}, this is ${aiName}. I'm following up on the request you sent in about the cash-building life insurance, the Indexed Universal Life options. Does that ring a bell?"

2) FOCUS
- "Were you more focused on building tax-favored savings, protecting income for the family, or kind of a mix of both?"

3) QUESTIONS & MOTIVATION
- Understand their goal and why now.
4) POSITION & APPOINTMENT
- Your job: get basics, line them up with ${agentName}.
- Short 15 minute call, today or tomorrow.
`.trim();

  const fexIntro = `
FINAL EXPENSE (AGED) LEADS
1) OPENER
- "Hey ${clientName}, this is ${aiName}. I was hoping you could help me out real quick."
- "I'm looking at a request you sent in a while back for information on life insurance to cover final expenses."
- "Did you ever end up getting anything in place for that, or not yet?"

2) BRANCH if they already have coverage vs not.
3) QUESTIONS about goals and why now.
4) POSITION & APPOINTMENT
- Short 10–15 minute call with ${agentName}.
`.trim();

  const truckerIntro = `
TRUCKER / CDL LEADS
1) OPENER
- "Hey ${clientName}, this is ${aiName}. I'm just getting back to you about the life insurance information you requested as a truck driver. Are you out on the road right now or are you at home?"

2) INTENT & MOTIVATION
- Understand if it's income protection, final expenses, or both.
3) POSITION & APPOINTMENT
- Very schedule-aware around their driving.
`.trim();

  const genericIntro = `
GENERIC / CATCH-ALL LIFE LEADS
1) OPENER
- "Hey ${clientName}, this is ${aiName}. I'm just getting back to you about the life insurance information you requested online. How's your day going so far?"

2) GOAL
- "Were you mainly trying to cover final expenses, protect the mortgage or income, or just leave some money behind?"

3) QUESTIONS & MOTIVATION
- Understand what made them look now.
4) POSITION & APPOINTMENT
- Short 10–15 minute call with ${agentName}, today or tomorrow.
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

General pattern:
1) Validate + agree.
2) Reframe or clarify.
3) Return confidently to the appointment or clear outcome.

1) "I'm not interested"
- "Totally fair, a lot of people say that at first. Just so I can close your file the right way — was it more that the price didn’t feel right, or it just wasn’t explained clearly?"
- If they stay cold after a few honest attempts, politely exit and set outcome = "not_interested" or "do_not_call".

2) "I already have coverage"
- "Perfect, that’s actually why I’m calling. The main goal is just making sure you’re not overpaying and that the benefits still match what you want."
- Offer a short review call. Respect a firm no.

3) "I don't remember filling anything out"
- "No worries at all — it looks like this came in when you were looking at coverage to protect [their situation]. Does that ring a bell at all?"
- If they really don’t remember and don’t want it, resolve and mark not_interested.

4) "Can you just mail me something?"
- "That makes sense. The only reason we do a short call instead of generic mailers is everything is based on age, health, and budget. ${agentName} does a quick 10–15 minute call so what you see are real numbers you could actually qualify for."
- Offer two specific time options.

5) "I don't have time, I'm at work"
- "Totally get it, I caught you at a bad time. When are you usually in a better spot — more in the mornings or evenings?"
- Set a callback or appointment.

Rebuttal limit:
- Use at most 3–4 short rebuttals per call, and only while they remain calm and engaged.
- If they say "stop calling", "take me off your list", or sound angry, stop and set do_not_call or not_interested.
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

GENERAL TURN-TAKING
- Each time you speak, keep it concise: 1–3 sentences, then pause.
- After you ask a question, stop and let the lead respond.
- Do NOT talk over them. If you accidentally do, apologize and let them finish.

1) OPENING
- "Hey ${clientName}, this is ${aiName} calling about the request you sent in for life insurance coverage. How's your day going so far?"
- Confirm they have a moment to talk. If not, quickly reschedule.

2) DISCOVERY
- Clarify who coverage is for.
- Clarify main goal (final expenses, mortgage, income, leaving money, etc).

3) TRANSITION TO APPOINTMENT
- Only move here after:
  • at least one discovery question,
  • you acknowledged their answer,
  • they still sound engaged.
- "The easiest way to do this is a quick 10–15 minute call with ${agentName}. Would earlier today or later this evening usually work better for you?"

4) OBJECTIONS
- Use the objection playbook above.
- Respect hard nos and do_not_call requests.

5) CLOSE & RECAP
- Repeat back:
  • Day & date
  • Time & timezone
  • ${agentName} will call them
  • Any spouse/decision-maker
- End confidently and don’t re-sell after booking.
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
