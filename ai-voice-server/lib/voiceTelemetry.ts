export type VoiceFeatureFlags = {
  contextPrefetchV1: boolean;
  adaptivePacingV1: boolean;
  naturalScriptV1: boolean;
};

export type VoiceResponseMetric = {
  sequence: number;
  reason: string;
  responseCreateAtMs: number;
  callerSpeechStoppedAtMs?: number;
  firstOpenAiAudioAtMs?: number;
  firstCoveOutboundAudioAtMs?: number;
  firstTwilioOutboundAudioAtMs?: number;
  responseDoneAtMs?: number;
  responseDurationMs?: number;
  usage?: Record<string, unknown>;
  audioBytes: number;
};

export type VoiceTelemetryState = {
  version: 1;
  callStartedAtMs: number;
  resolvedRealtimeModel: string;
  featureFlags: VoiceFeatureFlags;
  contextSource?: "prefetch" | "on_answer";
  prefetchFallbackReason?: string;
  speechStoppedTimestampsMs: number[];
  transcriptFinalTimestampsMs: number[];
  transcriptionUsage: Array<Record<string, unknown>>;
  responses: VoiceResponseMetric[];
  callerSpeechDurationMs: number;
  aiSpeechDurationMs: number;
  interruptionAttempts: number;
  currentCallerSpeechStartedAtMs?: number;
};

export function createVoiceTelemetry(args: {
  callStartedAtMs: number;
  resolvedRealtimeModel: string;
  featureFlags: VoiceFeatureFlags;
}): VoiceTelemetryState {
  return {
    version: 1,
    callStartedAtMs: args.callStartedAtMs,
    resolvedRealtimeModel: args.resolvedRealtimeModel,
    featureFlags: args.featureFlags,
    speechStoppedTimestampsMs: [],
    transcriptFinalTimestampsMs: [],
    transcriptionUsage: [],
    responses: [],
    callerSpeechDurationMs: 0,
    aiSpeechDurationMs: 0,
    interruptionAttempts: 0,
  };
}

export function beginCallerSpeech(telemetry: VoiceTelemetryState | undefined, atMs: number): void {
  if (!telemetry) return;
  telemetry.currentCallerSpeechStartedAtMs = atMs;
}

export function endCallerSpeech(telemetry: VoiceTelemetryState | undefined, atMs: number): void {
  if (!telemetry) return;
  telemetry.speechStoppedTimestampsMs.push(atMs);
  const startedAtMs = Number(telemetry.currentCallerSpeechStartedAtMs || 0);
  if (startedAtMs > 0 && atMs >= startedAtMs) {
    telemetry.callerSpeechDurationMs += atMs - startedAtMs;
  }
  telemetry.currentCallerSpeechStartedAtMs = undefined;
}

export function recordResponseCreate(
  telemetry: VoiceTelemetryState | undefined,
  atMs: number,
  reason: string
): VoiceResponseMetric | undefined {
  if (!telemetry) return undefined;
  const metric: VoiceResponseMetric = {
    sequence: telemetry.responses.length + 1,
    reason,
    responseCreateAtMs: atMs,
    callerSpeechStoppedAtMs:
      telemetry.speechStoppedTimestampsMs[telemetry.speechStoppedTimestampsMs.length - 1],
    audioBytes: 0,
  };
  telemetry.responses.push(metric);
  return metric;
}

export function currentResponseMetric(telemetry: VoiceTelemetryState | undefined): VoiceResponseMetric | undefined {
  if (!telemetry) return undefined;
  return telemetry.responses[telemetry.responses.length - 1];
}

export function buildVoiceMetricsSnapshot(
  telemetry: VoiceTelemetryState,
  endedAtMs: number,
  vendorCostPerMinuteUsd: number
): Record<string, unknown> {
  const connectedDurationMs = Math.max(0, endedAtMs - telemetry.callStartedAtMs);
  const callerSpeechDurationMs = telemetry.callerSpeechDurationMs + (
    telemetry.currentCallerSpeechStartedAtMs && endedAtMs >= telemetry.currentCallerSpeechStartedAtMs
      ? endedAtMs - telemetry.currentCallerSpeechStartedAtMs
      : 0
  );
  const connectedMinutes = connectedDurationMs / 60_000;
  const vendorRate = Number.isFinite(vendorCostPerMinuteUsd) && vendorCostPerMinuteUsd > 0
    ? vendorCostPerMinuteUsd
    : 0;
  const estimatedProviderCostUsd = vendorRate > 0 ? connectedMinutes * vendorRate : null;

  const responses = telemetry.responses.map((response) => ({
    ...response,
    callerFinishToResponseCreateMs:
      response.callerSpeechStoppedAtMs && response.responseCreateAtMs >= response.callerSpeechStoppedAtMs
        ? response.responseCreateAtMs - response.callerSpeechStoppedAtMs
        : null,
    responseCreateToFirstModelAudioMs:
      response.firstOpenAiAudioAtMs && response.firstOpenAiAudioAtMs >= response.responseCreateAtMs
        ? response.firstOpenAiAudioAtMs - response.responseCreateAtMs
        : null,
    callerFinishToFirstPlayableOutboundMs:
      response.callerSpeechStoppedAtMs && response.firstTwilioOutboundAudioAtMs &&
      response.firstTwilioOutboundAudioAtMs >= response.callerSpeechStoppedAtMs
        ? response.firstTwilioOutboundAudioAtMs - response.callerSpeechStoppedAtMs
        : null,
  }));

  return {
    version: telemetry.version,
    callStartedAt: new Date(telemetry.callStartedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    connectedDurationMs,
    callerSpeechDurationMs,
    aiSpeechDurationMs: telemetry.aiSpeechDurationMs,
    resolvedRealtimeModel: telemetry.resolvedRealtimeModel,
    estimatedProviderCostUsd,
    estimatedCostPerConnectedMinuteUsd: vendorRate > 0 ? vendorRate : null,
    interruptionAttempts: telemetry.interruptionAttempts,
    featureFlags: telemetry.featureFlags,
    contextSource: telemetry.contextSource || "on_answer",
    prefetchFallbackReason: telemetry.prefetchFallbackReason || null,
    speechStoppedTimestamps: telemetry.speechStoppedTimestampsMs.map((value) => new Date(value).toISOString()),
    transcriptFinalTimestamps: telemetry.transcriptFinalTimestampsMs.map((value) => new Date(value).toISOString()),
    transcriptionUsage: telemetry.transcriptionUsage,
    responses,
  };
}
