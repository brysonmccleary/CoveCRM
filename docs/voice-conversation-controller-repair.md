# Natural conversation controller repair — local verification

## Verdict and limits

Local repair is ready for a controlled **owner-only** live evaluation after separately authorized deployment. Nothing was committed, pushed, deployed, enabled, or called. Customer rollout is not approved. Actual spoken quality has NOT been demonstrated by offline tests.

The repair uses the existing `VOICE_NATURAL_CONVERSATION_TEST_V1` switch and exact-email `VOICE_PHASE1_TEST_EMAILS` allowlist. The signup demo and flag-disabled customer path are unchanged. Model selection is independently gated; changing the model alone does not enable these repairs.

## Confirmed root causes and sequential trace

The supplied failed-call logs and preserved legacy controller agree on four structural defects: coverage advancement leaves a stale pending question; uncertain time concerns fall through to a forced pending-question response; the string repeat guard changes wording without changing the objective; anger recovery outranks an explicit appointment refusal. Ordinary exact-script/mandatory-reclose instructions reinforce those errors.

The sequential offline regression includes the greeting reply and all six consequential turns, retaining the same call state throughout. The control group uses the current flag-disabled legacy controller, not a copied implementation or a dependency on mutable git history. Its repeat-guard route suffix can differ from the historical log, but the stale question and forced-reclose instruction are reproduced.

| Caller turn | Legacy state / instruction / observed call behavior | Repaired state / instruction |
| --- | --- | --- |
| Just me. | Coverage captured; script index 2, pending index 0. Scheduling spoken. | Coverage normalized to `self`; pending index 1, never coverage again without a genuine correction. |
| I don't really know if I can go over this. | `post_coverage_unknown_free`; stale coverage anchor ordered verbatim. Coverage question repeated in real call. | `conversation_time_availability`; retained `self`, pending 1; acknowledge availability without a question or scheduling pitch. |
| You just said that. | Correction handling returns to booking. Apology plus reclose in real call. | `conversation_repetition`; complaint count 1; own repetition, yield, no paraphrased reclose. |
| I don't know if I have time to go over it. | Unknown fallback replays booking frame. | Time-concern count 2; change to yielding strategy, preserve facts, no callback promise. |
| Yep, you already said that again. | Repeat guard merely rewords the scheduling choice. | Complaint count 2; no question; bounded attempt history persists. |
| You're such a shitty fucking AI. I would never meet with you. | `post_coverage_angry_recover` / recover-to-scheduling; another appointment ask. | Existing `policy_not_interested_exit`; farewell, pending goodbye hangup, Not Interested outcome, no scheduling and no new DNC behavior. |

The repaired column describes tested controller state and instructions, not fabricated model speech. No audio was generated in the harness.

## Model, voice and protected systems

The preserved internal newest-mini selection is exactly **`gpt-realtime-2.1-mini`**, with existing low reasoning effort. `voiceExperiment.ts` is byte-for-byte unchanged. The default remains the existing `OPENAI_REALTIME_MODEL` override or `gpt-realtime-mini` fallback; this task did not change either or inspect/verify the running deployment's environment. Consequently this is a source-level configuration confirmation, not a claim about the model running in production.

Kayla/marin, Jacob/cedar, alloy fallback, codec, transport, VAD, pacing, session/queue behavior, quiet hours, billing, lead selection, Telnyx and Twilio warning 21626 were not changed. No environment files or secrets were edited.

## Files and functions changed in this repair

- `ai-voice-server/index.ts`: `CallState` and `PolicyDecision` carry bounded conversational memory/strategy; new `conversationRepairDecision` selects concern/refusal/clarification behavior; new `reconcileConversationDecision` repairs pending state and detects repeated objective attempts; `handleConversationTurn` integrates the owner-gated strategy boundary; `buildResponseFromPolicy` supplies authoritative context and protects terminal wording; `buildSystemPrompt` makes the current turn's no-reclose rule override generic booking redirects; `handleOpenAiEvent` retains actual spoken transcript for hearing requests and conversational history.
- `ai-voice-server/lib/conversationRepair.ts`: compositional evidence extraction, conservative coverage fact parsing, objective/attempt memory, structured context, and model-led response instructions. No new API, provider, model, tool action or disposition system.
- `__tests__/ai-voice-conversation-repair.test.ts`: 41 sequential, language-variation, precedence and departure tests, including a legacy control group.
- `__tests__/helpers/voiceControllerHarness.ts`: hermetic execution of the real controller with offline sockets, timers and network doubles.
- This report.

Other pre-existing dirty files remain untouched. Before/after SHA-256 comparison across 3,224 existing tracked/untracked nonignored files found only `ai-voice-server/index.ts` modified by this repair. The callback implementation and `__tests__/ai-callback-progression.test.ts` matched their starting hashes exactly.

## Behavioral design

The server retains authority over facts, business steps, validated booking/transfer actions and outcomes. The model receives the current objective, known coverage/day/time, answered questions, pending index, caller concern, recent exchanges, recent objective attempts, permitted response actions and constraints. It chooses natural wording and handles contextual interpretation where uncertain; uncertain interpretation cannot itself authorize business actions.

Coverage corrections use the original transcript's correction evidence even when routing strips the correction prefix. Questions or hypothetical coverage mentions are not accepted as facts. The pending-index repair explicitly sets both awaiting fields so the generic post-response fallback cannot restore coverage index zero.

Repetition is handled by meaning at the controller-objective level, not just identical output text. Complaint turns suppress the booking ask. Repeated time concerns change strategy. Two same-objective ask attempts without fact progress cause a concern clarification rather than another paraphrase. Explicit hearing requests are separate and may repeat the last actually spoken content. Confirmations, terminal outcomes and transfer actions are excluded from this generic repeat guard.

Explicit appointment refusal takes priority over frustration and uses the existing Not Interested terminal path. Ordinary disinterest retains existing objection counters/exits but does not append another appointment ask. Frustration alone is not refusal/DNC. Existing opt-out routing and outcome handling remain in control; tests compare the preserved legacy behavior rather than introducing new opt-out state transitions.

Ordinary script wording was already flexible in the internal experiment. This repair additionally removes mandatory reclose behavior for concern/repetition/clarification turns and provides explicit prompt precedence over generic script redirects. Required identity/scope, no-underwriting rules, protected compliance/confirmation wording and deterministic actions remain. Terminal response wording is protected explicitly. The default customer script path is unchanged.

This is not a universal deterministic semantic classifier: bounded compositional cues handle consequential decisions, while the model interprets/responds to other concerns under a no-advancement boundary. Unseen language, negation and mixed intents still require live evaluation.

## Verification

- Relevant suite: `npx jest --runInBand --silent --testPathPatterns='(ai-|twilio|dialer|billing|session)'` — **436 tests, 23 suites passed**, including **41 new tests** and all existing **33 callback progression tests**.
- Coverage includes time/busy variations; repeated questions; frustration vs refusal vs opt-out; exact real-call sequence; ordinary disinterest counters; hearing vs repetition; actual spoken transcript memory; answer plus question; busy plus explanation; explicit correction; partial/hypothetical answers; voluntary scheduling after concern; later-to-live-transfer; objective repetition before a complaint.
- Root TypeScript: `npx tsc --noEmit --incremental false` — passed.
- Voice server: `npm run build` in `ai-voice-server` — passed.
- Relevant lint with `--no-ignore` — zero errors, 29 warnings in the existing server file; no lint fixes applied. The repository normally ignores the voice-server directory, so an explicit nonignored pass was necessary.
- Normal root `npm run build`, existing `.env.local` and `.env` unchanged — exit 0, including all 76 static pages and build traces. Existing browser-mapping, middleware-convention and duplicate-index warnings remain outside scope.

OpenAI Docs skill guidance informed the separation of clear state/exit rules from flexible delivery, rather than relaxing action authority. Reference: [Realtime prompting guidance](https://developers.openai.com/api/docs/guides/voice-prompting).

## Owner-only acceptance test still required

After explicit deployment authorization, confirm the intended owner allowlist, natural-conversation flag and newest-mini model in startup/session telemetry without enabling customers. Repeat the real sequence and variations, and inspect actual audio plus state transitions. Pass only if Kayla remembers coverage, responds directly to the concern, stops semantically repeating booking questions, distinguishes hearing from complaints, and honors explicit refusal without another scheduling ask. Also verify a normal confirmed appointment, legitimate transfer and existing opt-out path end to end.

Fail the test if delivery still sounds like forced acknowledgment plus reclose, if the model invents facts, or if any business action occurs without validated consent. No claim of ChatGPT Voice-equivalent experience or general production readiness is made here.
