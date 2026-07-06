# 06 OpenAI COGS

Static audit only. No OpenAI API calls were executed. Current public pricing was checked against the official OpenAI pricing page, but the page did not expose a `gpt-realtime-mini` rate in the fetched text. Treat exact dollars as dashboard/pricing-table reconciliation work.

## Findings

| rank | finding | evidence |
|---|---|---|
| P1 | OpenAI COGS meter is wall-clock socket/session duration from Twilio stream start to stop/close, not semantic talk time. | `ai-voice-server/index.ts:11294` sets call start; `ai-voice-server/index.ts:11866` bills on stop; `ai-voice-server/index.ts:10966` bills on websocket close. |
| P1 | Live transfer closes OpenAI on successful redirect, but cost accuracy depends on prompt Twilio stream close. | `ai-voice-server/index.ts:11270` closes OpenAI; close/stop billing at `ai-voice-server/index.ts:10966` and `ai-voice-server/index.ts:11866`. |
| P2 | Code uses `gpt-realtime-mini` by default and locks `audio/pcmu`; do not change these as part of cost optimization without separate production validation. | Model default at `ai-voice-server/index.ts:79`; audio format at `ai-voice-server/index.ts:81`; session format at `ai-voice-server/index.ts:12006`; VAD threshold at `ai-voice-server/index.ts:12019`. |
| P2 | OpenAI transcript model is configured per Realtime input audio, so transcription token/audio cost should be included in COGS if billed separately by the active pricing plan. | `ai-voice-server/index.ts:12007` configures `gpt-4o-mini-transcribe`. |

## Current Configuration

| setting | value | evidence |
|---|---|---|
| Realtime model | `process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini"` | `ai-voice-server/index.ts:79` |
| Audio format | `audio/pcmu` | `ai-voice-server/index.ts:81` |
| Output modality | audio only | `ai-voice-server/index.ts:12003` |
| Input transcription | `gpt-4o-mini-transcribe` | `ai-voice-server/index.ts:12007` |
| VAD | server VAD, 400ms silence, threshold 0.55 | `ai-voice-server/index.ts:12011`; `ai-voice-server/index.ts:12015`; `ai-voice-server/index.ts:12019` |
| Safety timeout | 20 minutes | `ai-voice-server/index.ts:11300` |

## Expected Formula

| item | formula from code |
|---|---|
| OpenAI Realtime audio input | Sum of caller audio seconds while OpenAI socket is open, priced by active Realtime audio input rate. |
| OpenAI Realtime audio output | Sum of generated audio seconds/tokens while socket is open, priced by active Realtime audio output rate. |
| Input transcription | Realtime transcription generated from caller audio, if billable separately for the active model/pricing tier. |
| CoveCRM AI dialer customer billing | User-facing session-time billing uses elapsed seconds and `$5/hr`, thresholded at `$20`. Evidence: `lib/billing/trackAiDialerSessionUsage.ts:85`; `lib/billing/trackAiDialerSessionUsage.ts:216`. |

## Pricing Source Note

The official OpenAI pricing page was checked on this audit pass: [OpenAI API pricing](https://developers.openai.com/api/docs/pricing). The fetched page navigation included Realtime docs/pricing links but did not expose a concrete `gpt-realtime-mini` price in the captured text, so this report does not assert a current per-minute/per-token rate.

