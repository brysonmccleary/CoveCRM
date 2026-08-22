import fs from "fs";
import path from "path";
import {
  adaptivePacingMs,
  authoritativeRoutingText,
  envFlagEnabled,
  isFreshPrefetchedContext,
  latestSelfCorrectionSegment,
  scriptWordingLevel,
  scopedFeatureEnabled,
} from "../ai-voice-server/lib/naturalConversation";
import {
  appendDurableTranscriptTurn,
  finalTranscriptTurns,
} from "../ai-voice-server/lib/durableTranscript";
import {
  beginCallerSpeech,
  buildVoiceMetricsSnapshot,
  createVoiceTelemetry,
  endCallerSpeech,
  recordResponseCreate,
} from "../ai-voice-server/lib/voiceTelemetry";

describe("AI Voice Phase 1 safe natural conversation helpers", () => {
  test("all behavior flags remain opt-in", () => {
    expect(envFlagEnabled(undefined)).toBe(false);
    expect(envFlagEnabled("false")).toBe(false);
    expect(envFlagEnabled("0")).toBe(false);
    expect(envFlagEnabled("true")).toBe(true);
    expect(envFlagEnabled("1")).toBe(true);
  });

  test("internal feature switches require both an allowlist match and their own toggle", () => {
    const internalEmails = new Set(["owner@example.com"]);
    expect(scopedFeatureEnabled({
      globalEnabled: false,
      internalTestEnabled: true,
      internalEmails,
      userEmail: "owner@example.com",
    })).toBe(true);
    expect(scopedFeatureEnabled({
      globalEnabled: false,
      internalTestEnabled: true,
      internalEmails,
      userEmail: "customer@example.com",
    })).toBe(false);
    expect(scopedFeatureEnabled({
      globalEnabled: false,
      internalTestEnabled: false,
      internalEmails,
      userEmail: "owner@example.com",
    })).toBe(false);
  });

  test.each([
    ["Yeah.", 35, 75],
    ["Um yeah.", 35, 75],
    ["Nope.", 35, 75],
    ["I think so.", 35, 75],
    ["Tuesday works.", 45, 90],
    ["Tuesday works—actually wait, sorry, Wednesday.", 60, 110],
  ])("adaptive pacing responds quickly to %s", (text, min, max) => {
    const value = adaptivePacingMs(text, true, 0.5);
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  });

  test("adaptive pacing retains a small pause for long objections", () => {
    const longAnswer = "Uh, I have been thinking about it for a while, but I am worried it will be too expensive and I really need to think about everything first.";
    expect(adaptivePacingMs(longAnswer, true, 0.5)).toBeGreaterThanOrEqual(140);
  });

  test("flag-off pacing exactly preserves the legacy 120-220ms range", () => {
    expect(adaptivePacingMs("Yeah", false, 0)).toBe(120);
    expect(adaptivePacingMs("Yeah", false, 0.999999)).toBe(220);
  });

  test.each([
    ["Tuesday—actually Wednesday", "Wednesday"],
    ["Tuesday, no wait, Wednesday", "Wednesday"],
    ["Tuesday, sorry, I meant Wednesday", "Wednesday"],
    ["Um, yeah", "Um, yeah"],
    ["I can do morning, actually afternoon", "afternoon"],
  ])("latest correction is authoritative: %s", (input, expected) => {
    expect(latestSelfCorrectionSegment(input)).toBe(expected);
  });

  test("routing applies clear appointment corrections but preserves conversational filler", () => {
    expect(authoritativeRoutingText("Tuesday—actually wait, Wednesday", true)).toBe("wait, Wednesday");
    expect(authoritativeRoutingText("Yes, actually no", true)).toBe("no");
    expect(authoritativeRoutingText("Um yeah, I mean I've kind of been thinking about it", true))
      .toBe("Um yeah, I mean I've kind of been thinking about it");
    expect(authoritativeRoutingText("Tuesday—actually Wednesday", false))
      .toBe("Tuesday—actually Wednesday");
  });

  test("script inventory defaults to very-close wording and protects exact details", () => {
    expect(scriptWordingLevel("Before we get started, can I ask a couple quick questions?")).toBe(2);
    expect(scriptWordingLevel("Your appointment is confirmed at 3:30 PM.")).toBe(1);
    expect(scriptWordingLevel("This call is recorded with your consent.")).toBe(1);
    expect(scriptWordingLevel("Gotcha.")).toBe(3);
    expect(scriptWordingLevel("Ordinary line", 1)).toBe(1);
  });

  test("prefetch accepts only fresh context for the exact session and lead", () => {
    const now = 100_000;
    const entry = { context: { ok: true }, fetchedAtMs: now - 1_000, sessionId: "s1", leadId: "l1" };
    expect(isFreshPrefetchedContext(entry, "s1", "l1", now, 90_000)).toBe(true);
    expect(isFreshPrefetchedContext(entry, "s2", "l1", now, 90_000)).toBe(false);
    expect(isFreshPrefetchedContext({ ...entry, fetchedAtMs: now - 90_001 }, "s1", "l1", now, 90_000)).toBe(false);
    expect(isFreshPrefetchedContext(undefined, "s1", "l1", now, 90_000)).toBe(false);
  });

  test("long calls retain every ordered durable turn, including repeated wording", () => {
    let turns: ReturnType<typeof appendDurableTranscriptTurn> = [];
    for (let i = 0; i < 80; i += 1) {
      turns = appendDurableTranscriptTurn(turns, {
        role: i % 2 === 0 ? "ai" : "lead",
        text: i % 10 === 0 ? "Okay." : `Turn ${i}`,
        source: "realtime",
        itemId: `item-${i}`,
        atMs: 1_000_000 + i * 2_000,
      });
    }
    const final = finalTranscriptTurns(turns);
    expect(final).toHaveLength(80);
    expect(final[0].text).toBe("Okay.");
    expect(final[79].text).toBe("Turn 79");
    expect(final.filter((turn) => turn.text === "Okay.")).toHaveLength(8);
  });

  test("provider transcript replaces its controller fallback without duplicating a turn", () => {
    let turns = appendDurableTranscriptTurn([], {
      role: "ai",
      text: "Tuesday works.",
      source: "controller",
      atMs: 10_000,
    });
    turns = appendDurableTranscriptTurn(turns, {
      role: "ai",
      text: "Okay, Tuesday works.",
      source: "realtime",
      itemId: "assistant-1",
      atMs: 11_000,
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ text: "Okay, Tuesday works.", source: "realtime" });
  });

  test("telemetry derives per-turn latency, speech duration, and configured cost", () => {
    const telemetry = createVoiceTelemetry({
      callStartedAtMs: 1_000,
      resolvedRealtimeModel: "gpt-realtime-mini",
      featureFlags: { contextPrefetchV1: true, adaptivePacingV1: true, naturalScriptV1: true },
    });
    beginCallerSpeech(telemetry, 2_000);
    endCallerSpeech(telemetry, 3_000);
    const response = recordResponseCreate(telemetry, 3_060, "script_step")!;
    response.firstOpenAiAudioAtMs = 3_300;
    response.firstCoveOutboundAudioAtMs = 3_300;
    response.firstTwilioOutboundAudioAtMs = 3_320;
    response.responseDoneAtMs = 4_000;
    response.responseDurationMs = 940;
    response.usage = { input_tokens: 20, output_tokens: 10 };
    telemetry.aiSpeechDurationMs = 500;
    telemetry.interruptionAttempts = 1;

    const snapshot: any = buildVoiceMetricsSnapshot(telemetry, 61_000, 0.05);
    expect(snapshot.connectedDurationMs).toBe(60_000);
    expect(snapshot.callerSpeechDurationMs).toBe(1_000);
    expect(snapshot.aiSpeechDurationMs).toBe(500);
    expect(snapshot.estimatedProviderCostUsd).toBeCloseTo(0.05);
    expect(snapshot.responses[0].callerFinishToResponseCreateMs).toBe(60);
    expect(snapshot.responses[0].responseCreateToFirstModelAudioMs).toBe(240);
    expect(snapshot.responses[0].callerFinishToFirstPlayableOutboundMs).toBe(320);
  });
});

describe("AI Voice Phase 1 frozen-path invariants", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "ai-voice-server/index.ts"), "utf8");
  const workerSource = fs.readFileSync(path.join(process.cwd(), "pages/api/ai-calls/worker.ts"), "utf8");

  test("proven VAD and PCMU configuration remains unchanged", () => {
    expect(source).toContain('const OPENAI_REALTIME_AUDIO_FORMAT = "audio/pcmu"');
    expect(source).toMatch(/turn_detection:\s*\{[\s\S]*?type:\s*"server_vad"[\s\S]*?silence_duration_ms:\s*400[\s\S]*?threshold:\s*0\.55[\s\S]*?prefix_padding_ms:\s*300/);
    expect(source).toContain("const TWILIO_FRAME_BYTES = 160");
    expect(source).toContain("const TWILIO_FRAME_MS = 20");
    expect(source).toContain("silenceBytes / buf.length >= 0.95");
    expect(source).toContain("if (a < 600) quiet++");
    expect(source).toContain("avgAbs < 300 && quietRatio >= 0.90");
    expect(source).toContain("(nowMs - startedAt) <= 3500");
    expect(source).toContain("(nowMs - lastLocalSpeechAt) <= 900");
    expect(source).toContain("(nowMs - stopAt) <= 1200");
  });

  test("current interruption cap/cancel behavior is documented and unchanged", () => {
    expect(source).toMatch(/bargeInAudioMsBuffered\s*=\s*Math\.min\(\s*800,/);
    expect(source).toContain("bargeInAudioMsBuffered || 0) >= 1200");
    expect(source).not.toContain('event: "clear"');
    expect(source).not.toContain('event: "mark"');
    expect(source).not.toContain("conversation.item.truncate");
  });

  test("Realtime remains answer-gated and the model alias is not migrated", () => {
    expect(source).toContain('process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini"');
    const handleStartIndex = source.indexOf("async function handleStart");
    const realtimeInitIndex = source.indexOf("await initOpenAiRealtime(ws, state)", handleStartIndex);
    expect(handleStartIndex).toBeGreaterThan(0);
    expect(realtimeInitIndex).toBeGreaterThan(handleStartIndex);
    expect(source).not.toContain("gpt-realtime-2.1");
  });

  test("internal prefetch is account scoped and ordinary calls retain flag-off behavior", () => {
    expect(source).toContain("VOICE_PHASE1_TEST_EMAILS");
    expect(source).toContain("VOICE_PREFETCH_CONTEXT_TEST_V1");
    expect(source).toContain("VOICE_ADAPTIVE_PACING_TEST_V1");
    expect(source).toContain("VOICE_NATURAL_SCRIPT_TEST_V1");
    expect(workerSource).toContain("VOICE_PHASE1_TEST_EMAILS.has(userEmail)");
    expect(workerSource).toContain("VOICE_PREFETCH_CONTEXT_TEST_V1 &&");
    expect(source).not.toContain("VOICE_NATURAL_SCRIPT_V1 ? latestSelfCorrectionSegment");
  });
});
