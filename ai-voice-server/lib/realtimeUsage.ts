import { INTERNAL_REALTIME_MODEL } from "./voiceExperiment";

// USD / million tokens, verified 2026-09-16. Not a combined telephony/STT bill.
// https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini
const RATES = { textInput: 0.60, cachedText: 0.06, textOutput: 2.40,
  audioInput: 10, cachedAudio: 0.30, audioOutput: 20 };

export function realtimeUsageCost(model: string, usage?: Record<string, unknown>) {
  const input: any = usage?.input_token_details;
  const output: any = usage?.output_token_details;
  const cached = input?.cached_tokens_details;
  const count = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const counts = {
    textInput: input?.text_tokens, audioInput: input?.audio_tokens,
    textOutput: output?.text_tokens, audioOutput: output?.audio_tokens,
    cachedText: cached?.text_tokens ?? (input?.cached_tokens === 0 ? 0 : undefined),
    cachedAudio: cached?.audio_tokens ?? (input?.cached_tokens === 0 ? 0 : undefined),
  };
  const complete = Object.values(counts).every(count) &&
    count(usage?.input_tokens) && count(usage?.output_tokens) &&
    counts.cachedText <= counts.textInput && counts.cachedAudio <= counts.audioInput &&
    counts.cachedText + counts.cachedAudio === input?.cached_tokens &&
    counts.textInput + counts.audioInput === usage?.input_tokens &&
    counts.textOutput + counts.audioOutput === usage?.output_tokens;
  if (model !== INTERNAL_REALTIME_MODEL || !complete) {
    return { estimatedCostUsd: null, counts, complete: false,
      reason: model !== INTERNAL_REALTIME_MODEL ? "unpriced_model" : "missing_or_inconsistent_token_breakdown" };
  }
  const estimatedCostUsd = ((counts.textInput - counts.cachedText) * RATES.textInput +
    counts.cachedText * RATES.cachedText + (counts.audioInput - counts.cachedAudio) * RATES.audioInput +
    counts.cachedAudio * RATES.cachedAudio + counts.textOutput * RATES.textOutput +
    counts.audioOutput * RATES.audioOutput) / 1_000_000;
  return { estimatedCostUsd, counts, complete: true, reason: "reported_token_usage" };
}
