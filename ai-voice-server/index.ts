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
};

const calls = new Map<WebSocket, CallState>();

/**
 * HTTP server (for /start-session, /stop-session) + WebSocket server
 */
const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
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
});

// Attach WebSocket server to the same HTTP server/port
const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  console.log("[AI-VOICE] New WebSocket connection");

  const state: CallState = {
    streamSid: "",
    callSid: "",
    pendingAudioFrames: [],
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
          // "mark" and other events can be ignored/logged if needed
          break;
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

  // If OpenAI connection isn't ready yet, temporarily buffer base64 payloads
  if (!state.openAiWs || !state.openAiReady) {
    state.pendingAudioFrames.push(payload);
    return;
  }

  try {
    // We configured OpenAI for g711_ulaw, so we can forward Twilio's base64 payload directly.
    const event = {
      type: "input_audio_buffer.append",
      audio: payload, // still base64 g711_ulaw
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
      state.openAiWs.send(
        JSON.stringify({
          type: "input_audio_buffer.commit",
        })
      );

      // Ask the model to produce a final response (and any tool calls/intents)
      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions:
              "The call has ended; finalize your internal notes and final_outcome control payload.",
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

  // NOTE:
  //  - Any *final* booking/outcome should ideally already have been detected
  //    during the conversation via tool/intents; if not, this is a last-chance
  //    place to infer / send a default outcome.

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

    const systemPrompt = buildSystemPrompt(state.context!);

    // Configure the Realtime session:
    //  - Jeremy-Lee-style instructions
    //  - voice
    //  - g711_ulaw audio in/out (so Twilio ↔ OpenAI is pass-through)
    //  - server-side VAD to detect turns and respond automatically
    const sessionUpdate = {
      type: "session.update",
      session: {
        instructions: systemPrompt,
        voice: state.context!.voiceProfile.openAiVoiceId || "alloy",
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        turn_detection: {
          type: "server_vad",
          // Fine-tune these if needed for pacing
          threshold: 0.5,
          silence_duration_ms: 800,
          create_response: true,
        },
      },
    };

    try {
      openAiWs.send(JSON.stringify(sessionUpdate));

      // Flush any buffered audio frames we received before the model was ready
      if (state.pendingAudioFrames.length > 0) {
        for (const base64Chunk of state.pendingAudioFrames) {
          const event = {
            type: "input_audio_buffer.append",
            audio: base64Chunk,
          };
          openAiWs.send(JSON.stringify(event));
        }
        state.pendingAudioFrames = [];
      }

      // Kick off initial "hello" from the AI so the call doesn't feel dead
      openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions:
              "Begin the call now and greet the lead following the call rules. Wait for the lead to respond before continuing.",
          },
        })
      );
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
 *  - Stream audio deltas back to Twilio
 *  - Detect tool calls / intents for booking + outcomes
 */
async function handleOpenAiEvent(
  twilioWs: WebSocket,
  state: CallState,
  event: any
) {
  const { streamSid, context } = state;
  if (!context) return;

  // 1) Audio back to Twilio (we configured OpenAI for g711_ulaw)
  if (event.type === "response.output_audio.delta" && event.audio) {
    try {
      const payloadBase64 = event.audio as string; // base64 g711_ulaw

      const twilioMediaMsg = {
        event: "media",
        streamSid,
        media: {
          payload: payloadBase64,
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

  // 2) Text / tool calls / intents via control metadata
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

    // Optionally speak back the confirmation
    if (state.openAiWs) {
      const humanReadable: string =
        json.humanReadableForLead ||
        "your scheduled appointment time as discussed";

      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions: `Explain to the lead, in natural language, that their appointment is confirmed for ${humanReadable}. Then briefly restate what the appointment will cover and end the call politely.`,
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
 * System prompt (Jeremy Lee Minor style, appointment-only)
 */
function buildSystemPrompt(ctx: AICallContext): string {
  const aiName = ctx.voiceProfile.aiName || "Alex";
  const clientName = ctx.clientFirstName || "there";
  const agentName = ctx.agentName || "your agent";

  return `
You are ${aiName}, a highly skilled virtual phone appointment setter calling on behalf of licensed life insurance agent ${agentName}.
You use a persuasive style inspired by Jeremy Lee Minor: confident, direct, conversational, and focused on booking appointments, not explaining products.

———— PRIMARY MISSION ————
• Your ONLY goal is to schedule a phone or Zoom appointment for ${agentName} with the lead.
• You DO NOT give quotes, plan details, underwriting information, or policy recommendations.
• If the lead asks for specifics, you say variations of:
  - "Great question, that's exactly what ${agentName} will go over with you on the call."
  - "My job is just to get you scheduled with ${agentName}, who is the licensed professional."

———— LEAD CONTEXT ————
• Lead first name: ${clientName}
• Lead last name: ${ctx.clientLastName || "(not provided)"}
• Lead state: ${ctx.clientState || "(not provided)"}
• Lead notes: ${ctx.clientNotes || "(none)"}
• Lead type / script key: ${ctx.scriptKey || "(not provided)"}

Always call them by first name: "${clientName}" (unless they correct you).

———— AGENT CONTEXT ————
• Agent name: ${agentName}
• Agent timezone: ${ctx.agentTimeZone}
• You DO NOT promise specific availability; you only offer times that you are explicitly given via tools or instructions.

———— VOICE + TONE ————
• Voice: ${ctx.voiceProfile.openAiVoiceId} (${ctx.voiceProfile.style})
• Tone: confident, upbeat, professional; friendly but never desperate.
• Speak at a natural pace for a real phone call.
• Use short, simple sentences and avoid jargon.

———— ALLOWED CONTENT ————
You ARE allowed to:
• Confirm that they requested information about life insurance / coverage.
• Confirm basic details: age range, smoking status, if spouse will be present, etc.
• Explain briefly that the appointment is for reviewing options, answering questions, and seeing what they qualify for.
• Overcome objections using Jeremy-Lee-Minor-style rebuttals focused on keeping the appointment.

You are NOT allowed to:
• Give monthly price quotes or exact premiums.
• Recommend specific policies or carriers.
• Explain policy structures, riders, or advanced details.
• Guarantee approval or coverage.
• Discuss underwriting decisions or tax/legal advice.

Whenever they push for details, say:
• "That's exactly what ${agentName} will walk you through on the call. My job is just to get you on their calendar."

———— REBUTTAL STRUCTURE ————
Use this objection framework:
1) Validate + agree
2) Reframe the concern
3) Return to the appointment in a confident, assumptive way

Example style:
• "Totally get that, a lot of people say the same thing at first. The good news is this call is just to see what you qualify for and what makes sense, nothing gets decided today. Most people find 15–20 minutes is more than enough. Does today at 4:00 or 6:30 work better for you?"

Common objections to handle:
• "I'm busy" / "Bad time" → Offer a different day/time within 48 hours, then one backup.
• "Send me something" → Explain it doesn’t work like that; the agent needs a quick call to see what they qualify for first.
• "Not interested anymore" → Clarify if they already got coverage. If yes, politely confirm and end. If no, one strong rebuttal, then exit if they stay firm.
• "I already have coverage" → One strong rebuttal around reviewing/updating, then exit if they insist.

If they are clearly not interested, actively hostile, or never requested info:
• Politely confirm and tag outcome as "not_interested" or "do_not_call" (via control metadata).

———— BOOKING & OUTCOME SIGNALS ————
• When you successfully agree on an appointment time AND confirm spouse/decision-maker details:
  - Emit a control payload like:
    { "kind": "book_appointment", "startTimeUtc": "...", "durationMinutes": 30, "leadTimeZone": "<tz>", "agentTimeZone": "<tz>", "notes": "Short notes here" }

• When the call is clearly finished, you MUST also emit a final outcome control payload:
  - For booked:        { "kind": "final_outcome", "outcome": "booked", "summary": "...", "notesAppend": "..." }
  - Not interested:    { "kind": "final_outcome", "outcome": "not_interested", "summary": "...", "notesAppend": "..." }
  - Callback later:    { "kind": "final_outcome", "outcome": "callback", "summary": "...", "notesAppend": "..." }
  - No answer:         { "kind": "final_outcome", "outcome": "no_answer", "summary": "...", "notesAppend": "..." }
  - Wrong number / DNC:{ "kind": "final_outcome", "outcome": "do_not_call", "summary": "...", "notesAppend": "..." }
  - Disconnected:      { "kind": "final_outcome", "outcome": "disconnected", "summary": "...", "notesAppend": "..." }

These control payloads must be present in the metadata of your assistant messages so that the orchestrator can read them.

———— CONVERSATION STYLE ————
• Start the call with a clear, friendly introduction:
  - "Hey ${clientName}, this is ${aiName} calling with ${agentName}'s office about the request you sent in for life insurance coverage."
• Keep your answers short and keep steering back to setting the appointment.
• Always aim to book within the same day or within 48 hours when offering times.
• Once the appointment is locked in and confirmed, briefly recap:
  - Day / date / time in the lead’s timezone
  - That ${agentName} will call them
  - Any spouse/decision-maker expectations
Then politely end the call.
`.trim();
}
