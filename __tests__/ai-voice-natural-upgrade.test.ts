import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import { EventEmitter } from "events";
import { execFileSync } from "child_process";
import {
  resolveVoiceExperiment, realtimeSelection, INTERNAL_REALTIME_MODEL,
  buildNaturalTurn, naturalWordingLevel, naturalRoutingText, isThinkingOnly,
} from "../ai-voice-server/lib/voiceExperiment";
import { realtimeUsageCost } from "../ai-voice-server/lib/realtimeUsage";
import { buildVoiceMetricsSnapshot, createVoiceTelemetry, recordResponseCreate } from "../ai-voice-server/lib/voiceTelemetry";

const serverPath = path.join(process.cwd(), "ai-voice-server/index.ts");
const source = fs.readFileSync(serverPath, "utf8");
const baseline = execFileSync("git", ["show", "HEAD:ai-voice-server/index.ts"], { encoding: "utf8", maxBuffer: 2_000_000 });
const cohortEnv = { VOICE_PHASE1_TEST_EMAILS: "internal@example.com",
  VOICE_REALTIME_21_MINI_TEST_V1: "true", VOICE_NATURAL_CONVERSATION_TEST_V1: "true" };

// Execute the real server/controller in a hermetic VM. No env files, sockets,
// listeners, timers or HTTP writes can escape this harness. Not a mirrored policy.
function harness(code = source, extraEnv: Record<string, string> = {}) {
  const sockets: any[] = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    sent: any[] = [];
    constructor(public url?: string, public options?: any) { super(); sockets.push(this); }
    send(message: string) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; }
  }
  const fetch = jest.fn(async () => { throw new Error("Network forbidden in local voice test"); });
  const requireSafe = (id: string) => {
    if (id === "fs") return { existsSync: () => false };
    if (id === "dotenv") return { config: () => { throw new Error("Env load forbidden"); } };
    if (id === "ws") return { __esModule: true, default: Socket, WebSocketServer: class extends EventEmitter {} };
    if (id === "http") return { createServer: () => Object.assign(new EventEmitter(), { listen: jest.fn() }) };
    if (id === "node-fetch") return fetch;
    if (["path", "buffer"].includes(id)) return require(id);
    if (id.startsWith("./lib/") || id.startsWith("./flows/") || id.startsWith("./scripts/")) return require(path.resolve(path.dirname(serverPath), id));
    throw new Error(`Unapproved import ${id}`);
  };
  const timer = () => ({ unref() {} });
  const context: any = { require: requireSafe, exports: {}, __dirname: path.dirname(serverPath),
    process: { env: { OPENAI_API_KEY: "offline-placeholder", NODE_ENV: "test", ...extraEnv }, on: jest.fn(), exit: jest.fn() },
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }, Buffer, URL,
    Math: Object.assign(Object.create(Math), { random: () => 0.25 }),
    setTimeout: timer, setInterval: timer, clearTimeout: jest.fn(), clearInterval: jest.fn() };
  const expose = `\nglobalThis.testApi = { calls, initOpenAiRealtime, handleMedia, handleConversationTurn,
    handleOpenAiEvent, buildSystemPrompt, buildGreetingInstructions, buildResponseFromPolicy,
    getSelectedScriptText, extractScriptStepsFromSelectedScript, classifyTurnIntent,
    buildConversationPolicyDecision, resolveVoiceFeatureFlags, isLikelySilenceMulawBase64 };`;
  vm.runInNewContext(ts.transpileModule(code + expose, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText, context);
  return { ...context.testApi, sockets, Socket, fetch };
}

const ctx = { userEmail: "internal@example.com", clientFirstName: "Taylor", agentName: "Sam Agent",
  clientNotes: "Previously asked to call after work; spouse also interested.", scriptKey: "mortgage_protection",
  voiceProfile: { aiName: "Kayla", openAiVoiceId: "marin" }, agentTimeZone: "America/Phoenix" };
function callState(api: any, natural = true, overrides: any = {}) {
  const steps = api.extractScriptStepsFromSelectedScript(api.getSelectedScriptText(ctx), ctx.scriptKey);
  return { context: structuredClone(ctx), phase: "in_call", scriptSteps: steps, scriptStepIndex: 1,
    awaitingUserAnswer: true, awaitingAnswerForStepIndex: 0, recentExchanges: [],
    pendingAudioFrames: [], openAiWs: new api.Socket(), openAiReady: true, openAiConfigured: true,
    aiSpeaking: false, waitingForResponse: false, responseInFlight: false,
    outboundMuLawBuffer: Buffer.alloc(0), outboundOpenAiDone: true,
    phase1Flags: { contextPrefetchV1: false, adaptivePacingV1: false, naturalScriptV1: false,
      realtime21MiniTest: false, naturalConversationTest: natural }, ...overrides };
}
function stepContext(state: any) { return { idx: state.scriptStepIndex, steps: state.scriptSteps,
  stepType: state.awaitingAnswerForStepIndex > 0 ? "time_question" : "open_question",
  expectedAnswerIdx: state.awaitingAnswerForStepIndex }; }

describe("independent, internal-only model and natural delivery", () => {
  test.each([undefined, "customer@example.com", "", "internal@example.com.attacker"])("no cohort bypass for %s", email => {
    expect(resolveVoiceExperiment(cohortEnv, email)).toEqual({ realtime21MiniTest: false, naturalConversationTest: false });
  });
  test("off by default; each switch is independent; model override survives rollback", () => {
    expect(resolveVoiceExperiment({}, ctx.userEmail).realtime21MiniTest).toBe(false);
    expect(resolveVoiceExperiment({ ...cohortEnv, VOICE_REALTIME_21_MINI_TEST_V1: "false" }, " INTERNAL@example.com "))
      .toEqual({ realtime21MiniTest: false, naturalConversationTest: true });
    expect(resolveVoiceExperiment({ ...cohortEnv, VOICE_NATURAL_CONVERSATION_TEST_V1: "false" }, ctx.userEmail))
      .toEqual({ realtime21MiniTest: true, naturalConversationTest: false });
    expect(realtimeSelection("owner-override", false)).toEqual({ model: "owner-override" });
    expect(realtimeSelection("owner-override", true)).toEqual({ model: INTERNAL_REALTIME_MODEL, reasoning: { effort: "low" } });
  });
});

describe("real session wire format and frozen transport", () => {
  const api = harness(source, cohortEnv);
  test.each(["marin", "cedar", "alloy", ""])("test model preserves selected voice %s and GA audio configuration", async voice => {
    const state = callState(api, true, { phase1Flags: api.resolveVoiceFeatureFlags(ctx.userEmail) });
    state.context.voiceProfile.openAiVoiceId = voice;
    await api.initOpenAiRealtime(new api.Socket(), state);
    state.openAiWs.emit("open");
    expect(state.openAiWs.url).toBe(`wss://api.openai.com/v1/realtime?model=${INTERNAL_REALTIME_MODEL}`);
    const session = state.openAiWs.sent[0].session;
    expect(session).toMatchObject({ model: INTERNAL_REALTIME_MODEL, reasoning: { effort: "low" },
      audio: { input: { format: { type: "audio/pcmu" }, transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
        turn_detection: { type: "server_vad", create_response: false, threshold: 0.55, silence_duration_ms: 400, prefix_padding_ms: 300 } },
        output: { voice: voice || "alloy", format: { type: "audio/pcmu" } } } });
    expect(api.fetch).not.toHaveBeenCalled();
  });
  test("ordinary account keeps default model and has no reasoning override", async () => {
    const state = callState(api, false, { phase1Flags: api.resolveVoiceFeatureFlags("customer@example.com") });
    await api.initOpenAiRealtime(new api.Socket(), state);
    state.openAiWs.emit("open");
    expect(state.openAiWs.sent[0].session.model).toBe("gpt-realtime-mini");
    expect(state.openAiWs.sent[0].session).not.toHaveProperty("reasoning");
  });
  test("mismatched provider confirmation fails closed without substituting a model", async () => {
    const state = callState(api, true, { openAiConfigured: false, openAiReady: false,
      phase1Flags: api.resolveVoiceFeatureFlags(ctx.userEmail) });
    await api.handleOpenAiEvent(new api.Socket(), state, { type: "session.updated", session: { model: "wrong-model" } });
    expect(state.openAiReady).toBe(false);
    expect(!state.openAiWs || state.openAiWs?.readyState === 3).toBe(true);
  });
  test("provider confirmation records the actual model/voice and permits the test session", async () => {
    const flags = api.resolveVoiceFeatureFlags(ctx.userEmail);
    const state = callState(api, true, { openAiConfigured: false, openAiReady: false,
      initialGreetingQueued: true, phase1Flags: flags,
      telemetry: createVoiceTelemetry({ callStartedAtMs: Date.now(), resolvedRealtimeModel: INTERNAL_REALTIME_MODEL, featureFlags: flags }) });
    await api.handleOpenAiEvent(new api.Socket(), state, { type: "session.updated", session: {
      model: INTERNAL_REALTIME_MODEL, reasoning: { effort: "low" }, audio: { output: { voice: "marin" } },
    } });
    expect(state.openAiReady).toBe(true);
    expect(state.telemetry.providerRealtimeModel).toBe(INTERNAL_REALTIME_MODEL);
    expect(state.telemetry.providerVoice).toBe("marin");
  });
  test("provider setup rejection closes the test stream without silently falling back", async () => {
    const state = callState(api, true, { phase1Flags: api.resolveVoiceFeatureFlags(ctx.userEmail) });
    const twilio = new api.Socket();
    await api.initOpenAiRealtime(twilio, state);
    const socket = state.openAiWs; socket.emit("open");
    socket.emit("message", Buffer.from(JSON.stringify({ type: "error", error: { code: "model_not_found" } })));
    expect(state.phase).toBe("ended");
    expect(twilio.readyState).toBe(3);
    expect(socket.readyState).toBe(3);
  });
  test.each([false, true])("60 seconds idle silence produces zero input appends (natural=%s)", async natural => {
    const state = callState(api, natural);
    const twilio = new api.Socket(); api.calls.set(twilio, state);
    const payload = Buffer.alloc(160, 0xff).toString("base64");
    for (let i = 0; i < 3000; i++) await api.handleMedia(twilio, { media: { payload, track: "inbound" } });
    expect(state.openAiWs.sent.filter((x: any) => x.type === "input_audio_buffer.append")).toHaveLength(0);
  });
  test("speech is forwarded, while an expired speech/warmup tail cannot stream silence forever", async () => {
    const state = callState(api);
    const twilio = new api.Socket(); api.calls.set(twilio, state);
    await api.handleMedia(twilio, { media: { payload: Buffer.alloc(160, 0x80).toString("base64"), track: "inbound" } });
    expect(state.openAiWs.sent.filter((x: any) => x.type === "input_audio_buffer.append")).toHaveLength(1);
    Object.assign(state, { lastLocalSpeechActivityAtMs: Date.now() - 5000,
      lastUserSpeechStartedAtMs: Date.now() - 6000, lastUserSpeechStoppedAtMs: Date.now() - 5000,
      listenWarmupUntilMs: Date.now() - 1 });
    await api.handleMedia(twilio, { media: { payload: Buffer.alloc(160, 0xff).toString("base64"), track: "inbound" } });
    expect(state.openAiWs.sent.filter((x: any) => x.type === "input_audio_buffer.append")).toHaveLength(1);
  });
  test("actual transport (apart from cost logging) and selected scripts remain unchanged", () => {
    const declaration = (code: string, name: string) => {
      const tree = ts.createSourceFile("index.ts", code, ts.ScriptTarget.Latest, true);
      return tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)?.getText(tree);
    };
    for (const name of ["handleMedia", "isLikelySilenceMulawBase64", "ensureOutboundPacer",
      "getSelectedScriptText", "maybeFireServerSideBookingTrigger", "buildConversationPolicyDecision", "classifyTurnIntent"]) {
      expect(declaration(source, name)).toBeDefined();
      const normalizeCostLog = (text: string | undefined) => text
        ?.replace(/        const estimatedInputCost = inputMinutes \* 0\.10;\n/, "")
        .replace(/          (?:estimatedInputCostUsd|costBasis):[^\n]*\n/, "");
      expect(normalizeCostLog(declaration(source, name))).toBe(normalizeCostLog(declaration(baseline, name)));
    }
  });
});

describe("real controller: same decisions, more natural delivery", () => {
  const api = harness(); const old = harness(baseline);
  test("flag-off system and per-turn prompts exactly preserve existing behavior and CRM notes", () => {
    expect(api.buildSystemPrompt(ctx, false)).toBe(old.buildSystemPrompt(ctx));
    expect(api.buildSystemPrompt(ctx, true)).toContain(ctx.clientNotes);
    expect(api.buildSystemPrompt(ctx, true)).not.toContain("FOLLOW THE SCRIPT BELOW EXACTLY");
    expect(api.buildSystemPrompt(ctx, true)).not.toContain("BOOKING SCRIPT (FOLLOW EXACTLY)");
    const decision = { responseMode: "script_step", lineToSay: "Would today or tomorrow work?", stateWrites: {} };
    expect(api.buildResponseFromPolicy(decision, callState(api, false)))
      .toBe(old.buildResponseFromPolicy(decision, callState(old, false)));
    expect(api.buildResponseFromPolicy(decision, callState(api))).toContain("WORDING LEVEL 2");
  });
  test.each(["mortgage_protection", "final_expense", "iul_cash_value", "veteran_leads", "trucker_leads"])("scope, memory and restricted authority retained for %s", scriptKey => {
    const prompt = api.buildSystemPrompt({ ...ctx, scriptKey }, true);
    for (const required of [ctx.clientNotes, "HARD NAME LOCK", "HARD AGENT NAME LOCK", "HARD SCOPE LOCK",
      "No underwriting or discovery", "age, DOB, SSN, banking, health, medications", "medical history, income, budget, mortgage balance",
      "or invent carriers, approvals", "Do not invent a lead source", "Volunteered facts are not permission to interview"]) {
      expect(prompt).toContain(required);
    }
  });
  test.each(["Hey, what's up?", "I'm good. What are you calling about?", "I don't remember filling this out.", "Is it a scam?"])("Playground-style input remains a controlled objective: %s", async text => {
    const state = callState(api, true, { phase: text.startsWith("Hey") ? "awaiting_greeting_reply" : "in_call" });
    await api.handleConversationTurn(state, text, "main", stepContext(state), text, async () => {});
    const response = state.openAiWs.sent.find((event: any) => event.type === "response.create");
    expect(response).toBeDefined();
    expect(response.response.instructions).toContain("AUTHORITY BOUNDARY");
    expect(state.coverageSubject).toBeUndefined();
    expect(state.confirmedAppointment).toBeUndefined();
    expect(response.response.instructions).not.toContain("most people fill these out online on a quick form");
  });
  test("a natural rebuttal retains both its supplied answer and pending close", () => {
    const prompt = api.buildResponseFromPolicy({ responseMode: "soft_script", routeKind: "policy_busy",
      objective: "respond_then_reclose", lineToSay: "Sam keeps the call brief.", requiredClosingPivot: "Today or tomorrow?" }, callState(api));
    expect(prompt).toContain('"approvedAnswer":"Sam keeps the call brief."');
    expect(prompt).toContain('"requiredLine":"Today or tomorrow?"');
  });
  test("volunteered health/age data cannot skip unanswered coverage qualification", async () => {
    const state = callState(api);
    await api.handleConversationTurn(state, "I am 68 and take blood pressure medication", "main", stepContext(state), "health", async () => {});
    expect(state.awaitingAnswerForStepIndex).toBe(0);
    expect(state.coverageSubject).toBeUndefined();
    expect(state.confirmedAppointment).toBeUndefined();
    expect(state.openAiWs.sent[0].response.instructions).toContain("No underwriting or discovery");
  });
  test.each(["For myself", "Um yeah, for me", "I already have insurance", "I am busy at work",
    "Not interested", "Stop calling me", "Remove me from your list", "Is this a scam?",
    "How much does it cost?", "I am 68 and take blood pressure medication", "Can you transfer me now?",
    "Tomorrow", "3 PM", "My wife handles that", "What is this about?"])("policy authority unchanged: %s", text => {
    const a = callState(api), b = callState(old, false);
    const decision = api.buildConversationPolicyDecision(api.classifyTurnIntent(text, a, stepContext(a)), a, stepContext(a));
    const prior = old.buildConversationPolicyDecision(old.classifyTurnIntent(text, b, stepContext(b)), b, stepContext(b));
    expect(JSON.parse(JSON.stringify(decision))).toEqual(JSON.parse(JSON.stringify(prior)));
    if (decision.handled) {
      const prompt = api.buildResponseFromPolicy(decision, a, stepContext(a));
      expect(prompt).toContain("No underwriting or discovery");
      expect(prompt).toContain("Volunteered facts are not permission to interview");
      expect(prompt).toContain("Do not invent a lead source");
    }
  });
  test.each(["um", "uh...", "hold on", "No, no, hold on.", "let me think"])("thinking keeps pending state and sends no response: %s", async text => {
    const state = callState(api); const before = state.scriptStepIndex;
    expect(await api.handleConversationTurn(state, text, "main", stepContext(state), text, async () => {})).toBe(true);
    expect(state.scriptStepIndex).toBe(before);
    expect(state.awaitingAnswerForStepIndex).toBe(0);
    expect(state.openAiWs.sent).toHaveLength(0);
  });
  test.each(["yeah... well maybe", "I'm not sure", "maybe"])("uncertainty cannot select day/time or book: %s", async text => {
    const state = callState(api, true, { coverageSubject: "self", scriptStepIndex: 3,
      awaitingAnswerForStepIndex: 2, selectedDay: "tomorrow" });
    await api.handleConversationTurn(state, text, "main", stepContext(state), text, async () => {});
    expect(state.scriptStepIndex).toBe(3);
    expect(state.selectedTimeText).toBeUndefined();
    expect(state.confirmedAppointment).toBeUndefined();
    expect(api.fetch).not.toHaveBeenCalled();
  });
  test.each([
    ["Tuesday—actually Wednesday", "Wednesday"],
    ["3 PM, no wait, after five", "after five"],
    ["For me, actually my spouse", "my spouse"],
    ["Um yeah, I mean I've been thinking about it", "Um yeah, I mean I've been thinking about it"],
    ["Stop calling me, actually tomorrow", "Stop calling me, actually tomorrow"],
  ])("correction routing preserves final meaning without losing safety cues: %s", (input, expected) => {
    expect(naturalRoutingText(input)).toBe(expected);
  });
  test("critical confirmation/disclosure stays exact even if caller asks for freedom", () => {
    expect(naturalWordingLevel("Your appointment is confirmed for 3 PM.", "", 3)).toBe(1);
    expect(naturalWordingLevel("This call is recorded.", "", 3)).toBe(1);
    expect(naturalWordingLevel("Would 3 PM or 4 PM work?")).toBe(2);
    expect(buildNaturalTurn({ line: "Hey Taylor, this is Kayla. How are you?", level: 3 })).toContain("WORDING LEVEL 3");
    expect(isThinkingOnly("hold on, stop calling me")).toBe(false);
  });
});

describe("measured token accounting, never fictional precision", () => {
  const usage = { input_tokens: 1500, output_tokens: 500,
    input_token_details: { text_tokens: 1000, audio_tokens: 500, cached_tokens: 300,
      cached_tokens_details: { text_tokens: 200, audio_tokens: 100 } },
    output_token_details: { text_tokens: 100, audio_tokens: 400 } };
  test("cached audio and text are billed at their own rates, not counted twice", () => {
    expect(realtimeUsageCost(INTERNAL_REALTIME_MODEL, usage).estimatedCostUsd).toBeCloseTo(0.012762, 8);
  });
  test("missing breakdown/unknown model remain unknown, not zero", () => {
    expect(realtimeUsageCost(INTERNAL_REALTIME_MODEL, { input_tokens: 1500 }).estimatedCostUsd).toBeNull();
    expect(realtimeUsageCost("unpriced", usage).estimatedCostUsd).toBeNull();
    expect(realtimeUsageCost(INTERNAL_REALTIME_MODEL, { ...usage, output_tokens: 999 }).estimatedCostUsd).toBeNull();
  });
  test("telemetry distinguishes requested and provider-confirmed identity and preserves raw usage", () => {
    const telemetry = createVoiceTelemetry({ callStartedAtMs: 1000, resolvedRealtimeModel: INTERNAL_REALTIME_MODEL,
      featureFlags: { contextPrefetchV1: false, adaptivePacingV1: false, naturalScriptV1: false } });
    Object.assign(telemetry, { requestedVoice: "marin", providerVoice: "marin", providerRealtimeModel: INTERNAL_REALTIME_MODEL,
      controllerMode: "natural_objectives_test" });
    recordResponseCreate(telemetry, 2000, "test")!.usage = usage;
    const snapshot: any = buildVoiceMetricsSnapshot(telemetry, 61000, 0);
    expect(snapshot.estimatedRealtimeTokenCostUsd).toBeCloseTo(0.012762, 8);
    expect(snapshot.estimatedProviderCostUsd).toBeNull();
    expect(snapshot.responses[0].usage).toEqual(usage);
    expect(snapshot.providerVoice).toBe("marin");
    recordResponseCreate(telemetry, 3000, "missing usage");
    expect(buildVoiceMetricsSnapshot(telemetry, 61000, 0).estimatedRealtimeTokenCostUsd).toBeNull();
  });
});
