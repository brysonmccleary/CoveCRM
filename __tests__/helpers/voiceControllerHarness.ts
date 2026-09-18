import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import { EventEmitter } from "events";
const serverPath = path.join(process.cwd(), "ai-voice-server/index.ts");
const source = fs.readFileSync(serverPath, "utf8");
// Hermetic real-controller harness: all I/O and timers are offline doubles.
export function harness(code = source, extraEnv: Record<string, string> = {}) {
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

export const ctx = { userEmail: "internal@example.com", clientFirstName: "Taylor", agentName: "Sam Agent",
  clientNotes: "Previously asked to call after work; spouse also interested.", scriptKey: "mortgage_protection",
  voiceProfile: { aiName: "Kayla", openAiVoiceId: "marin" }, agentTimeZone: "America/Phoenix" };
export function callState(api: any, natural = true, overrides: any = {}) {
  const steps = api.extractScriptStepsFromSelectedScript(api.getSelectedScriptText(ctx), ctx.scriptKey);
  return { context: structuredClone(ctx), phase: "in_call", scriptSteps: steps, scriptStepIndex: 1,
    awaitingUserAnswer: true, awaitingAnswerForStepIndex: 0, recentExchanges: [],
    pendingAudioFrames: [], openAiWs: new api.Socket(), openAiReady: true, openAiConfigured: true,
    aiSpeaking: false, waitingForResponse: false, responseInFlight: false,
    outboundMuLawBuffer: Buffer.alloc(0), outboundOpenAiDone: true,
    phase1Flags: { contextPrefetchV1: false, adaptivePacingV1: false, naturalScriptV1: false,
      realtime21MiniTest: false, naturalConversationTest: natural }, ...overrides };
}
export function stepContext(state: any) { return { idx: state.scriptStepIndex, steps: state.scriptSteps,
  stepType: state.awaitingAnswerForStepIndex > 0 ? "time_question" : "open_question",
  expectedAnswerIdx: state.awaitingAnswerForStepIndex }; }
