export type AiVoiceUsageTiming = {
  callStartedAtMs?: number;
  meterStoppedAtMs?: number;
};

export function computeAiVoiceUsageMinutes(
  { callStartedAtMs, meterStoppedAtMs }: AiVoiceUsageTiming,
  nowMs = Date.now(),
): number {
  const startedAtMs = callStartedAtMs ?? nowMs;
  const endedAtMs = meterStoppedAtMs ?? nowMs;
  const diffMs = Math.max(0, endedAtMs - startedAtMs);
  const rawMinutes = diffMs / 60000;
  return rawMinutes <= 0 ? 0.01 : Math.round(rawMinutes * 100) / 100;
}
