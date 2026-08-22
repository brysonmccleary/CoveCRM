# Voice AI Phase 1: safe natural conversation

Phase 1 is implemented as an opt-in controller upgrade. It does not change the Realtime model, VAD, codec, Media Stream topology, input forwarding, or interruption cancellation behavior.

## Rollout flags

All flags default to off:

- `VOICE_PREFETCH_CONTEXT_V1`: asks the voice server to prepare Cove/CRM context before Twilio dialing. The cached context is in-memory, identity-checked, valid for at most 90 seconds, and consumed once. Missing, stale, invalid, or failed prefetches use the existing on-answer context fetch. Set this flag consistently on the Next.js worker and voice-server services.
- `VOICE_ADAPTIVE_PACING_V1`: replaces the ordinary 120–220 ms delay with deterministic transcript heuristics. Short yes/no and scheduling answers use a shorter delay; corrections use a modest delay; long or emotional objections retain a small pause.
- `VOICE_NATURAL_SCRIPT_V1`: enables the wording inventory. Compliance, consent, monetary, numeric appointment/offer, and transfer language remains Level 1 exact. Most controller-selected script steps are Level 2 very-close wording. Only standalone neutral acknowledgements qualify for Level 3.

For isolated internal calls, keep those global flags off and use the narrower account cohort:

- `VOICE_PHASE1_TEST_EMAILS`: comma-separated internal account emails.
- `VOICE_PREFETCH_CONTEXT_TEST_V1`: enables prefetch only for allowlisted accounts.
- `VOICE_ADAPTIVE_PACING_TEST_V1`: enables adaptive pacing only for allowlisted accounts.
- `VOICE_NATURAL_SCRIPT_TEST_V1`: enables natural/script-fidelity delivery only for allowlisted accounts.

Each test switch is independent. A call receives a test feature only when its context owner email is in `VOICE_PHASE1_TEST_EMAILS` and that feature's `_TEST_V1` switch is true. Configure the allowlist and prefetch test switch on both the Next.js worker and voice-server services; adaptive pacing and natural delivery are evaluated by the voice server after verified context is loaded.

Disabling the flags restores the prior conversational behavior without a code, database, audio-server, or model rollback. Complete transcript storage and call metrics are correctness/observability changes and remain enabled.

## Per-call measurements

`AICallRecording.voiceMetrics` stores:

- speech-stop and transcript-final timestamps;
- each `response.create`, first OpenAI audio, first Cove-buffered audio, first measurable Twilio media send, and `response.done` timestamp;
- `response.done.usage` and transcription usage when OpenAI provides them;
- caller and AI speech duration, connected duration, per-response latency, resolved model, current-logic interruption attempts, context source, and flag state;
- estimated provider cost and cost per connected minute when `AI_DIALER_VENDOR_COST_PER_MIN_USD` is configured. The value remains `null` rather than inventing a rate when it is not configured.

No raw audio or secrets are stored in these metrics.

## Complete transcript behavior

The live prompt still receives only the existing short `recentExchanges` window. A separate ordered ledger retains the entire call for persistence. Final Realtime transcripts replace controller text fallbacks for the same turn, while genuinely repeated wording in later turns remains in the record.

## Manual conversation checks

1. Short answer: caller says “Yeah.” The next approved script step should begin promptly and remain in order.
2. Hesitation: caller says “Um, yeah, I think so.” The normal yes/no route should remain authoritative.
3. Correction: caller says “Tuesday works—actually wait, sorry, Wednesday.” Wednesday must be used by deterministic scheduling state.
4. Long objection: caller explains a concern at length. Cove may briefly acknowledge it, then must use the existing objection route and approved next step.
5. Explanation: caller says Tuesday is difficult because of work. Cove may use one neutral acknowledgment, then continue the selected script step without praise or a new strategy.
6. Context failure: make `/prefetch-context` unavailable or let the entry age past 90 seconds. The answered Media Stream must use the current on-answer fetch and only then initialize Realtime.
7. Long call: complete more than three exchanges and verify all ordered turns, including repeated phrases, are stored.

## Frozen Phase 2 behavior

The current barge-in path remains unchanged: caller accumulation is capped at 800 ms while cancellation requires 1,200 ms, and Twilio `clear`/`mark` plus assistant-item truncation are not present. Phase 1 only counts attempts detected by this existing logic.
